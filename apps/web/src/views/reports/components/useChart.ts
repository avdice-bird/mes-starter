import * as echarts from 'echarts';
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

/** ECharts 挂载助手（第 53 节）：容器 ref + option ref → 自动渲染与窗口自适应。
 *  option 放宽为 ComputedRef：调用方 computed 的字面量类型不必逐字段 as const。 */
type MaybeComputed<T> = Ref<T> | { readonly value: T };
export function useChart(el: Ref<HTMLElement | undefined>, option: MaybeComputed<echarts.EChartsOption | object>) {
  let chart: echarts.ECharts | null = null;
  const ready = ref(false);

  const render = () => {
    if (!el.value) return;
    if (!chart) chart = echarts.init(el.value);
    chart.setOption(option.value as echarts.EChartsOption, true);
    ready.value = true;
  };

  const onResize = () => chart?.resize();

  onMounted(() => {
    render();
    window.addEventListener('resize', onResize);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize);
    chart?.dispose();
    chart = null;
  });
  watch(option, render, { deep: true });

  return { ready };
}
