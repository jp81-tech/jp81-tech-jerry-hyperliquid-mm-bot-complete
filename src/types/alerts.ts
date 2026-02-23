export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
  EMERGENCY = 'EMERGENCY'
}

export enum AlertCategory {
  WHALE_POSITION_CHANGE = 'WHALE_POSITION_CHANGE',
  WHALE_LIQUIDATION_RISK = 'WHALE_LIQUIDATION_RISK',
  WHALE_UNDERWATER = 'WHALE_UNDERWATER',
  BIAS_SHIFT = 'BIAS_SHIFT',
  FLOW_REVERSAL = 'FLOW_REVERSAL',
  SQUEEZE_RISK = 'SQUEEZE_RISK',
  CONCENTRATION_RISK = 'CONCENTRATION_RISK',
  VOLATILITY_SPIKE = 'VOLATILITY_SPIKE',
  DRAWDOWN_LIMIT = 'DRAWDOWN_LIMIT',
  CONFIG_UPDATE = 'CONFIG_UPDATE',
  PAUSE_TRADING = 'PAUSE_TRADING',
  ERROR = 'ERROR',
  PNL_THRESHOLD = 'PNL_THRESHOLD',
  SHADOW_SIGNAL = 'SHADOW_SIGNAL',
  SMART_SIGNAL = 'SMART_SIGNAL'
}

export interface AlertAction {
  id: string
  label: string
  type: 'AUTO' | 'MANUAL' | 'CONFIRM'
  action: string
  params?: Record<string, any>
  executed: boolean
  executedAt?: Date
}

export interface Alert {
  id: string
  timestamp: Date
  token: string
  category: AlertCategory
  severity: AlertSeverity
  title: string
  message: string
  data: Record<string, any>
  acknowledged: boolean
  acknowledgedAt?: Date
  actions: AlertAction[]
  expiresAt?: Date
}

export interface AlertCondition {
  field: string
  operator: '>' | '<' | '>=' | '<=' | 'CROSSES_ABOVE' | 'CROSSES_BELOW'
  value: number
  cooldownMs?: number
}

export interface AlertRule {
  id: string
  token?: string
  category: AlertCategory
  severity: AlertSeverity
  condition: AlertCondition
  enabled: boolean
  lastTriggered?: Date
  actions: AlertAction[]
}


