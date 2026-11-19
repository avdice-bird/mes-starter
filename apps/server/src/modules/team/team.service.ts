import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/team.dto';

const TEAM_INCLUDE = {
  workCenter: { select: { code: true, name: true } },
  leader: { select: { id: true, code: true, name: true } },
  _count: { select: { employees: true } },
} satisfies Prisma.TeamInclude;

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.TeamWhereInput = query.keyword
      ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
      : {};
    const [list, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({ where, include: TEAM_INCLUDE, orderBy: { id: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.team.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const team = await this.prisma.team.findUnique({ where: { id }, include: TEAM_INCLUDE });
    if (!team) throw new BusinessException(ErrorCode.NOT_FOUND, '班组不存在');
    return team;
  }

  async create(dto: CreateTeamDto, operator: string) {
    if (dto.leaderId) await this.assertLeaderInTeam(dto.leaderId, null, dto.workCenterId);
    try {
      return await this.prisma.team.create({
        data: { code: dto.code, name: dto.name, workCenterId: dto.workCenterId, leaderId: dto.leaderId, createdBy: operator, updatedBy: operator },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BusinessException(ErrorCode.CONFLICT, `班组编码 ${dto.code} 已存在`);
      throw e;
    }
  }

  async update(id: number, dto: UpdateTeamDto, operator: string) {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) throw new BusinessException(ErrorCode.NOT_FOUND, '班组不存在');
    const workCenterId = dto.workCenterId ?? team.workCenterId;
    if (dto.leaderId) await this.assertLeaderInTeam(dto.leaderId, id, workCenterId);
    return this.prisma.team.update({ where: { id }, data: { ...dto, updatedBy: operator } });
  }

  /** 组长必须属于本班组（第 24 节用例 10） */
  private async assertLeaderInTeam(employeeId: number, teamId: number | null, workCenterId: number) {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { team: true } });
    if (!emp) throw new BusinessException(ErrorCode.VALIDATION, '组长员工不存在');
    if (emp.status !== 'ACTIVE') throw new BusinessException(ErrorCode.VALIDATION, '组长必须是在职员工');
    if (teamId !== null && emp.teamId !== teamId) {
      throw new BusinessException(ErrorCode.VALIDATION, `组长 ${emp.name} 不属于该班组`);
    }
    if (teamId === null && emp.team.workCenterId !== workCenterId) {
      throw new BusinessException(ErrorCode.VALIDATION, `组长 ${emp.name} 不属于该工作中心下的班组`);
    }
  }

  /** 有员工 → 409（第 24 节用例 9） */
  async remove(id: number) {
    const team = await this.prisma.team.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
    if (!team) throw new BusinessException(ErrorCode.NOT_FOUND, '班组不存在');
    if (team._count.employees > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `该班组下有 ${team._count.employees} 名员工，请先调组`);
    }
    await this.prisma.team.delete({ where: { id } });
  }
}
