import type { Directive } from 'vue';
import { useUserStore } from '@/stores/user';

/** v-permission="'material:create'"：无权限时移除元素。前端隐藏只是体验，后端 Guard 才是防线。 */
export const permission: Directive<HTMLElement, string | string[]> = {
  mounted(el, binding) {
    const store = useUserStore();
    const codes = Array.isArray(binding.value) ? binding.value : [binding.value];
    if (!codes.every((c) => store.has(c))) el.parentNode?.removeChild(el);
  },
};
