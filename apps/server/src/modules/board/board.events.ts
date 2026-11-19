/** 看板领域事件（第 48 节）：业务 Service 发事件，Gateway 监听推送——业务代码不依赖 WebSocket */

import { EventEmitter2 } from 'eventemitter2';

/** 事件总线 token：@nestjs/event-emitter 是 ESM（Jest CJS 不兼容），用 eventemitter2（CJS）直接实现 */
export const BOARD_EVENT_BUS = 'BOARD_EVENT_BUS';

export class BoardEventBus extends EventEmitter2 {}


export interface WorkReportCreatedEvent {
  workOrderId: number;
  workOrderCode: string;
  operationId: number;
  operationName: string;
  goodQty: number;
  defectQty: number;
  employeeName: string;
  workCenterId: number | null;
  at: string;
}

export interface EquipmentStatusChangedEvent {
  equipmentId: number;
  equipmentCode: string;
  equipmentName: string;
  workCenterId: number;
  fromStatus: string;
  toStatus: string;
  at: string;
}

export interface WorkOrderStatusChangedEvent {
  workOrderId: number;
  workOrderCode: string;
  fromStatus: string;
  toStatus: string;
  workCenterId: number | null;
  at: string;
}
