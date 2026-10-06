import { defineStore } from 'pinia'

// 班组身份：结算页只有「收费结算班组」能写；复核清单只有「管线巡查班」能提交；
// 保养台账只有「机电维修班」能写。其他入口一律只读，越权改动由服务层按归属驳回。
export type CrewKey = 'billing' | 'pipeline' | 'maintenance' | 'viewer'

export interface CrewProfile {
  key: CrewKey
  name: string
  owner: string
}

export const CREWS: CrewProfile[] = [
  { key: 'billing', name: '收费结算班组', owner: '入廊费/服务费结算' },
  { key: 'pipeline', name: '管线巡查班', owner: '欠费管线复核清单' },
  { key: 'maintenance', name: '机电维修班', owner: '入廊设施保养台账' },
  { key: 'viewer', name: '其他人员（只读）', owner: '无归属入口' },
]

export const CREW_BY_KEY: Map<CrewKey, CrewProfile> = new Map(CREWS.map((c) => [c.key, c]))

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
    crew: 'billing' as CrewKey,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    crewName(): string {
      return CREW_BY_KEY.get(this.crew)?.name ?? '未知班组'
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setCrew(key: CrewKey) {
      this.crew = key
      const profile = CREW_BY_KEY.get(key)
      if (profile) {
        this.operator = profile.name === '其他人员（只读）' ? '外部查看人' : `${profile.name}·值班员`
      }
    },
    requireCrew(key: CrewKey, entry: string): { ok: boolean; message: string } {
      if (this.crew === key) return { ok: true, message: '' }
      const actual = CREW_BY_KEY.get(this.crew)?.name ?? '当前身份'
      return { ok: false, message: `按归属驳回：「${entry}」只允许 ${CREW_BY_KEY.get(key)?.name} 提交，${actual}的入口为只读` }
    },
  },
})
