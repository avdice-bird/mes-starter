import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, SkillDto, UpdateEmployeeDto } from './dto/employee.dto';

const EMP_INCLUDE = {
  team: { select: { code: true, name: true, workCenterId: true } },
  user: { select: { id: true, username: true } },
  skills: true,
} satisfies Prisma.EmployeeInclude;

@Injectable()
export class EmployeeService {
  constructor(private prisma: PrismaService) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; status?: string; teamId?: number }) {
    // @Query() 裸对象：数值参数显式转换
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where: Prisma.EmployeeWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.teamId ? { teamId: Number(query.teamId) } : {}), // @Query 裸对象，字符串数字 defensively 转换
      ...(query.keyword && { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where, include: EMP_INCLUDE, orderBy: { id: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const emp = await this.prisma.employee.findUnique({ where: { id }, include: EMP_INCLUDE });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, '员工不存在');
    return emp;
  }

  async create(dto: CreateEmployeeDto, operator: string) {
    await this.assertTeam(dto.teamId);
    if (dto.userId) await this.assertUserFree(dto.userId);
    try {
      return await this.prisma.employee.create({
        data: { code: dto.code, name: dto.name, teamId: dto.teamId, userId: dto.userId, createdBy: operator, updatedBy: operator },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        // 用例 8 工号重复 / 用例 11 用户已被关联
        throw new BusinessException(ErrorCode.CONFLICT, '工号或关联用户已被使用');
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateEmployeeDto, operator: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, '员工不存在');
    if (dto.teamId) await this.assertTeam(dto.teamId);
    if (dto.userId) await this.assertUserFree(dto.userId, id);
    const data: Prisma.EmployeeUpdateInput = {
      name: dto.name, updatedBy: operator,
      ...(dto.teamId ? { team: { connect: { id: dto.teamId } } } : {}),
      ...(dto.userId !== undefined ? { user: dto.userId ? { connect: { id: dto.userId } } : { disconnect: true } } : {}),
    };
    return this.prisma.employee.update({ where: { id }, data });
  }

  /** 离职：status=LEFT + leftAt。历史不变（报工存快照），人可查 */
  async leave(id: number, operator: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, '员工不存在');
    if (emp.status === 'LEFT') return this.findOne(id);
    // 组长离职：先摘掉组长标记
    await this.prisma.team.updateMany({ where: { leaderId: id }, data: { leaderId: null } });
    return this.prisma.employee.update({ where: { id }, data: { status: 'LEFT', leftAt: new Date(), updatedBy: operator } });
  }

  /** 再入职：恢复 ACTIVE，工号不变（用例 7） */
  async rehire(id: number, operator: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, '员工不存在');
    if (emp.status === 'ACTIVE') return this.findOne(id);
    if (emp.userId) await this.assertUserFree(emp.userId, id);
    return this.prisma.employee.update({ where: { id }, data: { status: 'ACTIVE', leftAt: null, updatedBy: operator } });
  }

  /** 调组（用例 5）：teamId 更新 + EmployeeTransfer 变更记录（同事务） */
  async transfer(id: number, toTeamId: number, operator: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, '员工不存在');
    if (emp.status !== 'ACTIVE') throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '离职员工不能调组');
    if (emp.teamId === toTeamId) return this.findOne(id);
    await this.assertTeam(toTeamId);
    const [updated] = await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id }, data: { teamId: toTeamId, updatedBy: operator } }),
      this.prisma.employeeTransfer.create({
        data: { employeeId: id, fromTeamId: emp.teamId, toTeamId },
      }),
    ]);
    return updated;
  }

  /** 调组历史（历史不变原则的人员侧证据） */
  async transfers(id: number) {
    return this.prisma.employeeTransfer.findMany({
      where: { employeeId: id },
      include: { fromTeam: { select: { name: true } }, toTeam: { select: { name: true } } },
      orderBy: { id: 'desc' },
    });
  }

  /** 技能维护（整体覆盖） */
  async setSkills(id: number, skills: SkillDto[], operator: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, '员工不存在');
    for (const s of skills) {
      if (!s.opCode && !s.workCenterId) {
        throw new BusinessException(ErrorCode.VALIDATION, '技能必须指定工序编码或工作中心之一');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeSkill.deleteMany({ where: { employeeId: id } });
      // EmployeeSkill 无审计字段，操作人记到员工 updatedBy（技能归属主数据）
      await tx.employee.update({ where: { id }, data: { updatedBy: operator } });
      await tx.employeeSkill.createMany({
        data: skills.map((s) => ({ employeeId: id, opCode: s.opCode, workCenterId: s.workCenterId, level: s.level })),
      });
    });
    return this.findOne(id);
  }

  async remove(id: number) {
    const emp = await this.prisma.employee.findUnique({ where: { id }, include: { _count: { select: { transfers: true } } } });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, '员工不存在');
    // 有调组历史或离职记录的员工不物理删除（历史不变原则），转离职
    if (emp._count.transfers > 0 || emp.status === 'LEFT') {
      return this.leave(id, 'system');
    }
    await this.prisma.employee.delete({ where: { id } });
  }

  private async assertTeam(teamId: number) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new BusinessException(ErrorCode.NOT_FOUND, '班组不存在');
  }

  private async assertUserFree(userId: number, exceptEmployeeId?: number) {
    const exists = await this.prisma.employee.findFirst({
      where: { userId, ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}) },
    });
    if (exists) throw new BusinessException(ErrorCode.CONFLICT, `该用户已被员工 ${exists.name}（${exists.code}）关联`);
  }
}
