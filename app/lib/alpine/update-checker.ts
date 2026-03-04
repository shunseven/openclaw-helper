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
      
      async update() {
        if (!this.hasUpdate) return;
        if (!confirm(\`确定要更新到版本 v\${this.remoteVersion} 并重启吗？\`)) return;
        
        this.loading = true;
        try {
          const res = await fetch('/api/config/update/pull', { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            alert('更新成功，服务即将重启...');
            // Wait a bit for server to restart
            setTimeout(() => {
              window.location.reload();
            }, 3000);
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
