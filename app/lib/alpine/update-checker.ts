export const updateCheckerAlpine = `
  document.addEventListener('alpine:init', () => {
    Alpine.data('updateChecker', () => ({
      loading: false,
      hasUpdate: false,
      localVersion: '',
      remoteVersion: '',
      
      async init() {
        await this.checkVersion();
      },
      
      async checkVersion() {
        try {
          const res = await fetch('/api/config/update/version');
          if (res.ok) {
            const data = await res.json();
            this.localVersion = data.localVersion;
            this.remoteVersion = data.remoteVersion;
            this.hasUpdate = data.hasUpdate;
          }
        } catch (e) {
          console.error('Failed to check version', e);
        }
      },
      
      async waitForServer(maxWait = 300000) {
        const start = Date.now();
        const interval = 1000;
        await new Promise(r => setTimeout(r, 3000));
        while (Date.now() - start < maxWait) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch('/health', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) return true;
          } catch (e) {
            // console.debug('Waiting for server...', e);
          }
          await new Promise(r => setTimeout(r, interval));
        }
        return false;
      },

      async update() {
        if (!this.hasUpdate) return;
        if (!confirm(\`确定要更新到版本 v\${this.remoteVersion} 并重启吗？\`)) return;
        
        this.loading = true;
        try {
          const res = await fetch('/api/config/update/pull', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            const ready = await this.waitForServer();
            if (ready) {
              window.location.reload();
            } else {
              alert('服务重启超时，请手动刷新页面');
              this.loading = false;
            }
          } else {
            alert('更新失败: ' + data.message);
            this.loading = false;
          }
        } catch (e) {
          alert('更新请求失败');
          this.loading = false;
        }
      }
    }))
  })
`;
