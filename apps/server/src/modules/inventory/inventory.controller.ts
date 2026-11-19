import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { InventoryService } from './inventory.service';
import { TraceService } from './trace.service';
import { InventoryBalanceQueryDto, InventoryTransactionQueryDto, LotListQueryDto, MaterialIssueListQueryDto } from '../../common/dto/module-query.dto';
import { InventoryAdjustDto, ReceiptDto, ReturnMaterialDto } from '../../common/dto/module-query.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(
    private inventory: InventoryService,
    private trace: TraceService,
  ) {}

  @Get('warehouses')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '仓库列表' })
  warehouses() {
    return this.inventory.listWarehouses();
  }

  @Get('balances')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '库存余额列表（仓/料/批三维）' })
  balances(@Query() query: InventoryBalanceQueryDto) {
    return this.inventory.listBalances(query);
  }

  @Get('transactions')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '库存流水列表（只读；只有 create，没有 update/delete）' })
  transactions(@Query() query: InventoryTransactionQueryDto) {
    return this.inventory.listTransactions(query);
  }

  @Get('lots')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '批次列表' })
  lots(@Query() query: LotListQueryDto) {
    return this.inventory.listLots(query);
  }

  @Get('audit')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '守恒审计：每个（仓,料,批）余额 = 流水和；不平列出清单' })
  audit() {
    return this.inventory.audit();
  }

  @Post('material-issues/generate/:workOrderId')
  @Permissions('material-issue:create')
  @ApiOperation({ summary: '按 BOM 展开生成领料单（已有 DRAFT 复用）' })
  generate(
    @Param('workOrderId', ParseIntPipe) workOrderId: number,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.inventory.generateIssue(workOrderId, req.user.username);
  }

  @Get('material-issues')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '领料单列表' })
  issues(@Query() query: MaterialIssueListQueryDto) {
    return this.inventory.listIssues(query);
  }

  @Get('material-issues/:id')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '领料单详情（含明细）' })
  issueDetail(@Param('id', ParseIntPipe) id: number) {
    return this.inventory.getIssue(id);
  }

  @Post('material-issues/:id/issue')
  @Permissions('material-issue:issue')
  @ApiOperation({ summary: '执行领料：事务内 FIFO 扣余额 + 流水；不足 2001 整单回滚' })
  issue(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.inventory.issue(id, req.user.username);
  }

  @Post('returns')
  @Permissions('material-issue:issue')
  @ApiOperation({ summary: '退料：RETURN 流水，余额回增，issuedQty 减少' })
  returnMaterial(
    @Body() dto: ReturnMaterialDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.inventory.returnMaterial(dto, req.user.username);
  }

  @Post('adjust')
  @Permissions('inventory:adjust')
  @ApiOperation({ summary: '库存调整：ADJUST 流水 + reason；直接改余额的其他接口不存在' })
  adjust(
    @Body() dto: InventoryAdjustDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.inventory.adjust(dto, req.user.username);
  }

  @Post('receipts/:workOrderId')
  @Permissions('receipt:create')
  @ApiOperation({ summary: '完工入库：生成成品批次 + 余额 + RECEIPT 流水；qty ≤ completedQty − 已入库' })
  receipt(
    @Param('workOrderId', ParseIntPipe) workOrderId: number,
    @Body() dto: ReceiptDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.inventory.receipt(workOrderId, dto, req.user.username);
  }
}

@ApiTags('lots')
@ApiBearerAuth()
@Controller('lots')
export class LotsController {
  constructor(private trace: TraceService) {}

  @Get(':lotNo/trace-back')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '反向追溯：成品批次 → 领料 → 原料批次（树）' })
  traceBack(@Param('lotNo') lotNo: string) {
    return this.trace.traceBack(lotNo);
  }

  @Get(':lotNo/trace-forward')
  @Permissions('inventory:view')
  @ApiOperation({ summary: '正向追溯：原料批次 → 工单 → 成品批次（树）' })
  traceForward(@Param('lotNo') lotNo: string) {
    return this.trace.traceForward(lotNo);
  }
}
