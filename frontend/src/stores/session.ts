import { defineStore } from 'pinia'

// 平台内的责任班组：费用结算、管线运维各管各的入口，其他人只读。
export const TEAM_FEE = '廊位费结算班'
export const TEAM_PIPELINE = '管线运维一班'
export const TEAM_OTHER = '巡检班'

export interface TeamProfile {
  team: string
  operator: string
  /** 该班组负责、可以提交写操作的入口 key */
  writableKeys: string[]
}

export const TEAM_PROFILES: TeamProfile[] = [
  { team: TEAM_FEE, operator: '沈结算', writableKeys: ['fee', 'contract'] },
  { team: TEAM_PIPELINE, operator: '林管线', writableKeys: ['pipeline', 'maintenance'] },
  { team: TEAM_OTHER, operator: '周巡检', writableKeys: [] },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '沈结算',
    team: TEAM_FEE,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    profile(state): TeamProfile {
      return (
        TEAM_PROFILES.find((item) => item.team === state.team) ?? TEAM_PROFILES[2]
      )
    },
    /** 返回是否可对某入口提交写操作；不是本责任班组一律只读。 */
    canWrite(): (key: string) => boolean {
      return (key: string) => this.profile.writableKeys.includes(key)
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchTeam(team: string) {
      const profile = TEAM_PROFILES.find((item) => item.team === team)
      if (profile) {
        this.team = profile.team
        this.operator = profile.operator
      }
    },
  },
})
