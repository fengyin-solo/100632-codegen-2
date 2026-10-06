<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">城市地下综合管廊运行维护管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向管廊主体台账、入廊管线登记、费用结算、环境监测、设备运维与作业审批的一体化运行维护工作台。</span>
        <span class="head-user">
          当前值班：{{ store.operator }} · {{ store.team }} · {{ store.shiftLabel }}
          <label class="team-switch">
            切换班组
            <select :value="store.team" @change="onTeamChange">
              <option v-for="p in profiles" :key="p.team" :value="p.team">
                {{ p.team }}（{{ p.operator }}）
              </option>
            </select>
          </label>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { TEAM_PROFILES, useSessionStore } from '@/stores/session'

const store = useSessionStore()
const profiles = TEAM_PROFILES

const navItems = [
  { label: "运营概览", path: "/" },
  { label: "费用结算·入廊费服务费", path: "/fee" },
  { label: "费用结算·服务合同", path: "/fee/contracts" },
  { label: "费用结算·外部文件进出", path: "/fee/inbox" },
  { label: "管线复核清单(欠费联动)", path: "/pipeline-review" },
  { label: "保养台账(与结算对齐)", path: "/fee/maintenance" },
  { label: "入廊管线登记(原台账)", path: "/pipeline" },
  { label: "管廊主体台账", path: "/tunnel" },
  { label: "廊内环境监测", path: "/envmonitor" },
  { label: "通风系统运维", path: "/ventilation" },
  { label: "廊内排水运维", path: "/drainage" },
  { label: "消防系统运维", path: "/firecontrol" },
  { label: "廊内照明运维", path: "/lighting" },
  { label: "门禁安防运维", path: "/access" },
  { label: "廊内巡检任务", path: "/patrol" },
  { label: "结构沉降监测", path: "/settlement" },
  { label: "渗漏水处置", path: "/leak" },
  { label: "设施检修管理", path: "/maintenance" },
  { label: "隐患整改管理", path: "/hazard" },
  { label: "应急演练管理", path: "/emergency" },
  { label: "廊内能耗计量", path: "/energy" },
  { label: "设备台账管理", path: "/device" },
  { label: "入廊作业审批", path: "/entryapprove" },
  { label: "运维值班交接", path: "/duty" },
]

function onTeamChange(event: Event) {
  store.switchTeam((event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.team-switch {
  margin-left: 10px;
  font-size: 12px;
}
.team-switch select {
  margin-left: 4px;
  padding: 2px 4px;
}
</style>
