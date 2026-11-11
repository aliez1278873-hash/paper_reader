const {contextBridge, ipcRenderer} = require('electron');
//取得两 Electron工具 contextBridge把方法提供给页面 ipcRenderer从页面这一侧向主进程传消息
//IPC是进程间通信，它连接的是本机的页面与主进程
//preload和页面运行在不同的JS上下文,contextBridge只暴露你列出的这几个函数，通道名写死在preload里，页面无法调用别的通道，是白名单式暴露

contextBridge.exposeInMainWorld('modelAPI',{
    //页面能够调用四个方法（如window.modelAPI.getSettings();）分别是取得可显示的配置 | 提交配置 | 请求翻译 | 翻译停止
    getSettings: () => ipcRenderer.invoke('model:get-settings'),
    saveSettings: settings => ipcRenderer.invoke('model:save-settings', settings),
    translate: text => ipcRenderer.invoke('translation:run', text),
    cancel: () => ipcRenderer.invoke('translation:cancel'),
});