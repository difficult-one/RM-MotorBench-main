<script setup lang="ts">
import {computed} from 'vue';import {evaluateTest} from '../../test_metrics.js';
const props=defineProps<{record:any}>();const evaluation=computed(()=>evaluateTest(props.record));
const number=(value:any,suffix='')=>value===null?'未达到/不适用':`${Number(value).toFixed(2)}${suffix}`;
</script>
<template><section v-if="record.context.test" class="test-results"><h3>自动测试评价</h3><p v-if="!evaluation.valid" class="warning">无法给出有效动态指标：{{ evaluation.reason }}</p><template v-else><p class="subtle">按板端读取反馈时刻评价，单位 {{ evaluation.unit }}。稳定带 ±{{ number(evaluation.band) }} {{ evaluation.unit }}，持续至少200ms；稳态误差为末20%段的目标减实测均值。</p><table><thead><tr><th>目标 {{ evaluation.unit }}</th><th>超调</th><th>稳定时间</th><th>稳态误差</th></tr></thead><tbody><tr v-for="(segment,index) in evaluation.segments" :key="index"><td>{{ number(segment.target) }}</td><td>{{ number(segment.overshootPercent,'%') }}</td><td>{{ number(segment.settlingMs,'ms') }}</td><td>{{ number(segment.steadyError) }}</td></tr></tbody></table><p class="subtle">斜坡只评价保持段误差；板端时间代表读取反馈时刻。模拟数据不代表实物动态性能。</p></template></section></template>
