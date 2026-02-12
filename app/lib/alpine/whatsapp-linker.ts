/**
 * 配置中心 — WhatsApp 渠道添加 Alpine.js 组件
 * 完整流程：QR 扫码链接 → 手机模式选择 → DM 策略配置 → 号码白名单 → 保存
 * 参考 openclaw 项目 src/channels/plugins/onboarding/whatsapp.ts 的逻辑
 */
export const whatsappLinkerAlpine = `
document.addEventListener('alpine:init', () => {
  Alpine.data('whatsappLinker', () => ({
    /**
     * 状态机：
     *   idle → loading → qr → phoneMode → personalConfig | separateConfig → saving → success
     *                                                                       ↗
     *   任何状态都可进入 error
     */
    state: 'idle',
    loadingStep: '',
    qrDataUrl: '',
    errorMsg: '',
    pollCount: 0,
    maxPolls: 60,
    _pollTimer: null,

    // ── 配置数据（对应 openclaw onboarding 步骤） ──
    phoneMode: '',           // 'personal' | 'separate'
    phoneNumber: '',         // 个人模式下的手机号码（E.164 格式）
    dmPolicy: 'pairing',     // DM 策略：pairing | allowlist | open | disabled
    allowFromText: '',       // 白名单号码（逗号/换行分隔）

    destroy() {
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
    },

    // ── 步骤 1: 启动 QR 链接 ──
    async startLinking() {
      this.state = 'loading';
      this.loadingStep = '正在检查 WhatsApp 插件状态...';
      this.errorMsg = '';
      this.qrDataUrl = '';
      this.pollCount = 0;

      try {
        this.loadingStep = '① 注销旧 WhatsApp 会话...';
        const res = await fetch('/api/config/whatsapp/link/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        this.loadingStep = '② 生成二维码中...';
        const result = await res.json();

        if (!result.success) {
          this.state = 'error';
          this.errorMsg = result.error || 'WhatsApp 链接启动失败';
          return;
        }

        if (!result.data.qrDataUrl) {
          this.state = 'error';
          this.errorMsg = result.data.message || '未能获取二维码，请确认 Gateway 已启动且 WhatsApp 插件已安装';
          return;
        }

        this.qrDataUrl = result.data.qrDataUrl;
        this.state = 'qr';
        this.pollLinkStatus();
      } catch (err) {
        this.state = 'error';
        this.errorMsg = '网络错误: ' + (err.message || '请检查网络连接');
      }
    },

    // ── 步骤 2: 轮询扫码状态 ──
    async pollLinkStatus() {
      if (this.state !== 'qr') return;
      if (this.pollCount >= this.maxPolls) {
        this.state = 'error';
        this.errorMsg = '等待超时，请重新生成二维码';
        return;
      }

      this.pollCount++;
      try {
        const res = await fetch('/api/config/whatsapp/link/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const result = await res.json();

        if (!result.success) {
          // 515/restart 错误：后端会自动重试和检查凭据，但如果仍失败，
          // 前端继续轮询几次（后端重启可能需要时间）
          const errMsg = result.error || '';
          if (/515|restart|重启/i.test(errMsg) && this.pollCount < this.maxPolls - 5) {
            console.log('WhatsApp: 检测到 515 重启，继续轮询等待...');
            this._pollTimer = setTimeout(() => this.pollLinkStatus(), 5000);
            return;
          }
          // 其他硬性错误，停止轮询
          this.state = 'error';
          this.errorMsg = errMsg || 'WhatsApp 链接失败';
          return;
        }

        if (result.data.connected) {
          // QR 扫码成功 → 进入手机模式选择（对应 openclaw onboarding 的 phoneMode 步骤）
          this.state = 'phoneMode';
          return;
        }

        // 继续轮询
        this._pollTimer = setTimeout(() => this.pollLinkStatus(), 3000);
      } catch {
        // 网络错误时继续尝试
        this._pollTimer = setTimeout(() => this.pollLinkStatus(), 5000);
      }
    },

    // ── 步骤 3: 选择手机模式（对应 openclaw 的 phoneMode 选择） ──
    selectPhoneMode(mode) {
      this.phoneMode = mode;
      this.errorMsg = '';
      if (mode === 'personal') {
        // 个人手机 → 需要输入号码
        this.state = 'personalConfig';
      } else {
        // 专用号码 → 需要选择 DM 策略
        this.state = 'separateConfig';
      }
    },

    // ── 步骤 4: 保存配置 ──
    async saveConfig() {
      // 前端校验
      if (this.phoneMode === 'personal') {
        const phone = this.phoneNumber.trim();
        if (!phone) {
          this.errorMsg = '请输入你的 WhatsApp 手机号码';
          return;
        }
        // 简单格式校验
        const cleaned = phone.replace(/[\\s\\-()]/g, '');
        if (!/^\\+?\\d{7,15}$/.test(cleaned)) {
          this.errorMsg = '号码格式不正确，请使用国际格式如 +8613800138000';
          return;
        }
      }

      this.state = 'saving';
      this.errorMsg = '';

      try {
        const body = { phoneMode: this.phoneMode };

        if (this.phoneMode === 'personal') {
          body.phoneNumber = this.phoneNumber.trim();
        } else {
          body.dmPolicy = this.dmPolicy;
          // 解析白名单号码
          if (this.allowFromText.trim()) {
            body.allowFrom = this.allowFromText
              .split(/[,;\\n]+/)
              .map(s => s.trim())
              .filter(Boolean);
          }
        }

        const res = await fetch('/api/config/whatsapp/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await res.json();

        if (!result.success) {
          this.state = this.phoneMode === 'personal' ? 'personalConfig' : 'separateConfig';
          this.errorMsg = result.error || '配置保存失败';
          return;
        }

        this.state = 'success';
        window.dispatchEvent(new CustomEvent('show-alert', {
          detail: { type: 'success', message: 'WhatsApp 渠道配置成功！' }
        }));
        // 刷新渠道列表
        if (typeof htmx !== 'undefined') {
          htmx.ajax('GET', '/api/partials/channels', { target: '#channel-list', swap: 'innerHTML' });
          htmx.ajax('GET', '/api/partials/channels/available', { target: '#available-channels', swap: 'innerHTML' });
        }
      } catch (err) {
        this.state = 'error';
        this.errorMsg = '保存配置失败: ' + (err.message || '未知错误');
      }
    },

    // ── 跳过配置（使用默认 pairing 策略） ──
    async skipConfig() {
      this.state = 'saving';
      this.errorMsg = '';

      try {
        const res = await fetch('/api/config/whatsapp/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneMode: 'separate', dmPolicy: 'pairing' }),
        });
        const result = await res.json();

        if (!result.success) {
          this.state = 'error';
          this.errorMsg = result.error || '配置保存失败';
          return;
        }

        this.state = 'success';
        window.dispatchEvent(new CustomEvent('show-alert', {
          detail: { type: 'success', message: 'WhatsApp 连接成功！使用默认配对码策略。' }
        }));
        if (typeof htmx !== 'undefined') {
          htmx.ajax('GET', '/api/partials/channels', { target: '#channel-list', swap: 'innerHTML' });
          htmx.ajax('GET', '/api/partials/channels/available', { target: '#available-channels', swap: 'innerHTML' });
        }
      } catch (err) {
        this.state = 'error';
        this.errorMsg = '配置保存失败: ' + (err.message || '未知错误');
      }
    },

    reset() {
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
      this.state = 'idle';
      this.qrDataUrl = '';
      this.errorMsg = '';
      this.pollCount = 0;
      this.phoneMode = '';
      this.phoneNumber = '';
      this.dmPolicy = 'pairing';
      this.allowFromText = '';
    },

    close() {
      this.reset();
      const area = document.getElementById('channel-form-area');
      if (area) area.innerHTML = '';
    }
  }))
})
`
