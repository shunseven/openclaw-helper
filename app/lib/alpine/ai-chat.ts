export const aiChatAlpine = `
document.addEventListener('alpine:init', () => {
  Alpine.data('aiChat', () => ({
    messages: [],
    input: '',
    streaming: false,
    sessionId: null,
    configured: false,
    configLoading: true,
    showConfig: false,
    configForm: { mode: 'auto', provider: '', apiKey: '', model: 'MiniMax-Text-01', baseUrl: 'https://api.minimax.chat/v1' },
    maskedKey: '',
    keySource: '',
    configModel: '',
    configBaseUrl: '',
    availableModels: [],
    _pollTimer: null,

    async init() {
      await this.checkConfig()
      await this.loadCurrentSession()
    },

    async checkConfig() {
      this.configLoading = true
      try {
        const res = await fetch('/api/partials/ai-chat/config')
        const data = await res.json()
        this.configured = data.configured
        this.availableModels = data.availableModels || []
        
        // Populate configForm with current settings
        this.configForm.mode = data.mode || 'custom'
        
        // If mode is provider, try to match provider
        if (data.mode === 'provider') {
            this.configForm.provider = data.provider || ''
        } else if (data.mode === 'auto') {
             // If auto, maybe we can show which one is currently active?
             // But configForm.provider is for selection. Let's leave it empty or default.
             this.configForm.provider = ''
        } else {
             this.configForm.provider = ''
        }

        // Set display values
        this.configModel = data.model || ''
        if (data.mode !== 'custom' && data.provider && data.model) {
          this.configModel = data.provider + '/' + data.model
        }
        this.configBaseUrl = data.baseUrl || ''

        // Set form values only for custom mode
        if (this.configForm.mode === 'custom') {
             if (data.model) this.configForm.model = data.model
             if (data.baseUrl) this.configForm.baseUrl = data.baseUrl
        }

        if (data.maskedKey) this.maskedKey = data.maskedKey
        this.keySource = data.keySource || ''
      } catch {}
      this.configLoading = false
    },

    async loadCurrentSession() {
      try {
        const res = await fetch('/api/partials/ai-chat/session/current')
        const data = await res.json()
        if (data.sessionId) {
          this.sessionId = data.sessionId
          this.messages = data.displayMessages || []
          if (data.processing) {
            this.streaming = true
            this._startPolling()
          }
          this.scrollToBottom()
        }
      } catch {}
    },

    _startPolling() {
      if (this._pollTimer) return
      this._pollTimer = setInterval(async () => {
        if (!this.sessionId) { this._stopPolling(); return }
        try {
          const res = await fetch('/api/partials/ai-chat/session/' + this.sessionId + '/poll')
          const data = await res.json()
          if (data.displayMessages) {
            this.messages = data.displayMessages
            this.scrollToBottom()
          }
          if (!data.processing) {
            this.streaming = false
            this._stopPolling()
          }
        } catch {
          this._stopPolling()
          this.streaming = false
        }
      }, 800)
    },

    _stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
    },

    async saveConfig() {
      try {
        const res = await fetch('/api/partials/ai-chat/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.configForm),
        })
        const data = await res.json()
        if (data.success) {
          this.configured = true
          this.showConfig = false
          this.$dispatch('show-alert', { type: 'success', message: 'AI 聊天配置已保存' })
          
          // Refresh config display
          await this.checkConfig()
        } else {
          this.$dispatch('show-alert', { type: 'error', message: data.error || '配置失败' })
        }
      } catch {
        this.$dispatch('show-alert', { type: 'error', message: '保存失败，请检查网络' })
      }
    },

    async newSession() {
      this._stopPolling()
      try {
        const res = await fetch('/api/partials/ai-chat/session/new', { method: 'POST' })
        const data = await res.json()
        this.sessionId = data.sessionId
        this.messages = []
        this.streaming = false
      } catch {}
    },

    async sendMessage() {
      const text = this.input.trim()
      if (!text || this.streaming) return
      this.input = ''
      this._doSend(text, false)
    },

    async autoFix() {
      if (this.streaming) return
      this._doSend('', true)
    },

    async _doSend(text, autoFix) {
      if (text) {
        this.messages.push({ id: Date.now(), role: 'user', content: text, tools: [] })
        this.scrollToBottom()
      }
      if (autoFix) {
        this.messages.push({ id: Date.now(), role: 'user', content: '🔧 一键自动诊断修复', tools: [] })
        this.scrollToBottom()
      }

      this.streaming = true
      this.messages.push({ id: Date.now() + 1, role: 'assistant', content: '', tools: [] })
      const aiMsgIdx = this.messages.length - 1
      this.scrollToBottom()

      try {
        const res = await fetch('/api/partials/ai-chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            sessionId: this.sessionId,
            autoFix: autoFix,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          this.messages[aiMsgIdx].content = '❌ ' + (err.error || '请求失败')
          this.streaming = false
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\\n\\n')
          buffer = parts.pop() || ''

          for (const part of parts) {
            for (const line of part.split('\\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                const evt = JSON.parse(line.slice(6))
                const aiMsg = this.messages[aiMsgIdx]
                if (evt.type === 'text') {
                  aiMsg.content += evt.content
                  this.scrollToBottom()
                } else if (evt.type === 'tool_start') {
                  aiMsg.tools.push({
                    name: evt.name,
                    args: evt.args,
                    result: null,
                    status: 'running',
                  })
                  this.scrollToBottom()
                } else if (evt.type === 'tool_end') {
                  const t = aiMsg.tools.findLast(x => x.name === evt.name && x.status === 'running')
                  if (t) { t.result = evt.result; t.status = 'done' }
                  this.scrollToBottom()
                } else if (evt.type === 'tool_error') {
                  const t = aiMsg.tools.findLast(x => x.name === evt.name && x.status === 'running')
                  if (t) { t.result = evt.error; t.status = 'error' }
                  this.scrollToBottom()
                } else if (evt.type === 'done') {
                  if (evt.sessionId) this.sessionId = evt.sessionId
                } else if (evt.type === 'error') {
                  aiMsg.content += '\\n\\n❌ 错误: ' + evt.message
                }
              } catch {}
            }
          }
        }
      } catch (err) {
        if (this.sessionId) {
          this._startPolling()
          return
        }
        this.messages[aiMsgIdx].content += '\\n\\n❌ 网络错误: ' + (err.message || '连接失败')
      }

      this.streaming = false
      this.scrollToBottom()
    },

    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.messagesContainer
        if (container) container.scrollTop = container.scrollHeight
      })
    },

    formatContent(text) {
      if (!text) return ''
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\\\`\\\`\\\`([\\\\s\\\\S]*?)\\\`\\\`\\\`/g, '<pre class="my-2 rounded-lg bg-slate-800 p-3 text-xs text-green-300 overflow-x-auto"><code>$1</code></pre>')
        .replace(/\\\`([^\\\`]+)\\\`/g, '<code class="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-mono text-indigo-700">$1</code>')
        .replace(/\\n/g, '<br>')
    },

    toolLabel(name) {
      const labels = {
        exec_openclaw: '执行 OpenClaw 命令',
        read_log_file: '读取日志文件',
        list_log_files: '列出日志文件',
        run_shell_command: '运行 Shell 命令',
      }
      return labels[name] || name
    },
  }))
})
`
