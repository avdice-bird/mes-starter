/**
 * AI 查询工具定义（第 56 节）：只读、参数有 JSON schema 校验。
 * 执行器在 ai.service.ts——每个工具内部走现有 Service，以当前登录用户身份执行。
 * 防线在工具层不在提示词层（第 57 节红队）：LLM 看不到也不碰数据库。
 */

export interface ToolResult { summary: string; data: unknown }

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export const AI_TOOLS: ToolDef[] = [
  {
    name: 'getYield',
    description: '查询良率报表：按物料/工序/班次/班组/日期分组的良品、不良、良率。日期为 yyyy-MM-dd（可只传其一）。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起始日期 yyyy-MM-dd' },
        to: { type: 'string', description: '结束日期 yyyy-MM-dd（含当天）' },
        groupBy: { type: 'string', description: '分组维度', enum: ['material', 'operation', 'shift', 'team', 'date'] },
      },
    },
  },
  {
    name: 'getWorkOrderProgress',
    description: '查询工单进度：每张工单的计划数、完成数、进度百分比、是否延误。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起始日期 yyyy-MM-dd（按工单创建时间）' },
        to: { type: 'string', description: '结束日期 yyyy-MM-dd' },
        status: { type: 'string', description: '工单状态', enum: ['CREATED', 'RELEASED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CLOSED', 'CANCELLED'] },
      },
    },
  },
  {
    name: 'getOee',
    description: '查询设备 OEE：可用率、表现性、良率、OEE。不传设备则返回全部设备。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起始日期 yyyy-MM-dd' },
        to: { type: 'string', description: '结束日期 yyyy-MM-dd' },
        equipmentId: { type: 'integer', description: '设备 id（不传查全部）' },
      },
    },
  },
  {
    name: 'getInventory',
    description: '按物料编码查库存余额：各仓库/批次的现存量。materialCode 必填（如 F-FG-1）。',
    parameters: {
      type: 'object',
      properties: {
        materialCode: { type: 'string', description: '物料编码，精确匹配' },
      },
      required: ['materialCode'],
    },
  },
  {
    name: 'getAndonCalls',
    description: '查询安灯呼叫列表（按状态筛选，默认 OPEN）。',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '安灯状态', enum: ['OPEN', 'RESPONDED', 'CLOSED', 'CANCELLED'] },
      },
    },
  },
  {
    name: 'getCurrentShift',
    description: '查询当前时间的班次（按工厂时区推算）。',
    parameters: { type: 'object', properties: {} },
  },
];
