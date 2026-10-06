import { buildInitialFeeState } from './fee-seed'
import type { FeeState } from './fee-types'

// 结算专项独立持久化键，与通用台账的 urban-utility-tunnel:entries 互不干扰。
const FEE_KEY = 'urban-utility-tunnel:fee-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read(): FeeState {
  const fallback = buildInitialFeeState()
  if (typeof window === 'undefined' || !window.localStorage) return clone(fallback)
  const raw = window.localStorage.getItem(FEE_KEY)
  if (!raw) {
    window.localStorage.setItem(FEE_KEY, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    // 用种子做底，后续新增的数据表（如版本升级后）也能拿到缺省值
    return { ...clone(fallback), ...(JSON.parse(raw) as FeeState) }
  } catch {
    window.localStorage.setItem(FEE_KEY, JSON.stringify(fallback))
    return clone(fallback)
  }
}

let cache: FeeState | null = null

export function feeState(): FeeState {
  if (cache === null) cache = read()
  return cache
}

export function saveFeeState(state: FeeState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(FEE_KEY, JSON.stringify(state))
  }
}

export function resetFeeState(): FeeState {
  const fresh = buildInitialFeeState()
  saveFeeState(fresh)
  return clone(fresh)
}

export function feeStorageKey(): string {
  return FEE_KEY
}
