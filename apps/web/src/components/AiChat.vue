<template>
  <!-- AI 查询悬浮球与对话框（第 56 节）：ai:query 权限才显示 -->
  <template v-if="user.permissions.includes('ai:query')">
    <button class="ai-fab no-print" :class="{ on: open }" @click="open = !open">
      <el-icon :size="24"><ChatDotRound /></el-icon>
    </button>
    <transition name="ai-slide">
      <div v-if="open" class="ai-panel">
        <div class="ai-head">
          <span>AI 查询 · 生产数据</span>
          <el-button link @click="open = false">收起</el-button>
        </div>
        <div ref="msgEl" class="ai-msgs">
          <div v-if="!messages.length" class="ai-hint">
            试试问：
            <div v-for="q in hints" :key="q" class="ai-hint-q" @click="ask(q)">{{ q }}</div>
          </div>
          <div v-for="(m, i) in messages" :key="i" class="ai-msg" :class="m.role">
            <div v-if="m.toolCalls?.length" class="ai-tools">
              <el-tag v-for="t in m.toolCalls" :key="t.name + t.summary" size="small" type="info" class="ai-tool-tag">
                {{ t.name }} · {{ t.summary }}
              </el-tag>
            </div>
            <div class="ai-bubble" data-testid="ai-answer" v-html="m.html" />
          </div>
          <div v-if="busy" class="ai-msg ai">
            <div class="ai-bubble ai-busy">查询中…</div>
          </div>
        </div>
        <div class="ai-input">
          <el-input
            v-model="question" placeholder="问生产数据，如：本周良率最低的工序"
            :disabled="busy" maxlength="2000" @keyup.enter="ask()"
          />
          <el-button type="primary" :loading="busy" :disabled="!question.trim()" @click="ask()">发送</el-button>
        </div>
      </div>
    </transition>
  </template>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { ChatDotRound } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { aiQuery, type AiToolCall } from '@/api/ai';
import { useUserStore } from '@/stores/user';

/** AI 查询对话框：回答 markdown 渲染（DOMPurify 消毒）；工具调用以 tag 展示。 */
const user = useUserStore();
const open = ref(false);
const busy = ref(false);
const question = ref('');
const msgEl = ref<HTMLElement>();
const hints = ['本周良率最低的工序是哪个', '现在有哪些进行中的工单', '目前有几个待响应的安灯'];

interface AiMsg { role: 'user' | 'ai'; html: string; toolCalls?: AiToolCall[] }
const messages = ref<AiMsg[]>([]);

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

async function scrollBottom() {
  await nextTick();
  msgEl.value?.scrollTo({ top: msgEl.value.scrollHeight, behavior: 'smooth' });
}

async function ask(preset?: string) {
  const q = (preset ?? question.value).trim();
  if (!q || busy.value) return;
  question.value = '';
  messages.value.push({ role: 'user', html: renderMarkdown(q) });
  await scrollBottom();
  busy.value = true;
  try {
    const r = await aiQuery(q);
    messages.value.push({ role: 'ai', html: renderMarkdown(r.answer), toolCalls: r.toolCalls });
  } catch (e) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    ElMessage.error(msg ?? 'AI 查询失败');
  } finally {
    busy.value = false;
    await scrollBottom();
  }
}
</script>

<style scoped>
.ai-fab {
  position: fixed; right: 24px; bottom: 24px; z-index: 2000;
  width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
  background: #409eff; color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(64, 158, 255, .45);
}
.ai-fab.on { background: #909399; }
.ai-fab:hover { background: #66b1ff; }
.ai-panel {
  position: fixed; right: 24px; bottom: 84px; z-index: 2000;
  width: 460px; height: 560px; max-height: calc(100vh - 120px);
  background: #fff; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.18);
  display: flex; flex-direction: column; overflow: hidden;
}
.ai-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid #eee; font-weight: 600; }
.ai-msgs { flex: 1; overflow-y: auto; padding: 12px; }
.ai-hint { color: #999; font-size: 12px; }
.ai-hint-q { margin: 6px 0; padding: 6px 10px; background: #f4f6fa; border-radius: 8px; cursor: pointer; color: #409eff; }
.ai-hint-q:hover { background: #ecf5ff; }
.ai-msg { margin-bottom: 10px; display: flex; flex-direction: column; }
.ai-msg.user { align-items: flex-end; }
.ai-bubble { max-width: 88%; padding: 8px 12px; border-radius: 10px; background: #f4f6fa; font-size: 13px; overflow-wrap: break-word; }
.ai-msg.ai .ai-bubble { background: #ecf5ff; }
.ai-bubble :deep(table) { border-collapse: collapse; margin: 6px 0; font-size: 12px; }
.ai-bubble :deep(th), .ai-bubble :deep(td) { border: 1px solid #dcdfe6; padding: 3px 8px; }
.ai-bubble :deep(th) { background: #f4f6fa; }
.ai-bubble :deep(p) { margin: 4px 0; }
.ai-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.ai-tool-tag { font-size: 11px; }
.ai-busy { color: #999; }
.ai-input { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #eee; }
.ai-slide-enter-active, .ai-slide-leave-active { transition: all .2s; }
.ai-slide-enter-from, .ai-slide-leave-to { opacity: 0; transform: translateY(16px); }
</style>
