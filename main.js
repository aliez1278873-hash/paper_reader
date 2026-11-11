const { app, BrowserWindow, ipcMain } = require('electron/main')
const path = require('node:path');
const {DEFAULT_SETTINGS, normalizeConfig, translateText} = require('./model-client');

//导入了三个 Electron 模块：app	管理程序生命周期、BrowserWindow	创建和管理桌面窗口、ipcMain	在主进程中接收页面发来的 IPC 消息
//path用于拼接文件路径
//model-client.js导入三个函数

let mainWindow;
let modelConfig = null;
let activeRequest = null;   //记住当前请求的停止控制器

function publicSettings(){
  return modelConfig //使用三元运算符，已经配置过就返回当前地址、模型和有密钥；尚未配置，就返回默认设置和没有密钥
    ? {baseUrl: modelConfig.baseUrl, model: modelConfig.model, hasKey: true}
    : {...DEFAULT_SETTINGS, hasKey: false};
}

function handle(channel, handler) {
  //注册一个频道，并包一层安全校验和错误处理 channel：频道名 handler：真正的业务函数
  ipcMain.handle(channel, async (event, args) => {
    if(event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame){
      //确认消息来自你的主窗口 确认是窗口的主框架发的
      return {ok: false, message: '请求来源无效。'};
    }
    try {return { ok: true, value: await handler(args)}; }
    catch (error) { return { ok: false, message: error.message || '操作未完成，请重新尝试。'}; } 
  });
}

handle('model:get-settings',() => publicSettings());
handle('model:save-settings', input => {
  if (activeRequest) throw new Error('请先等待翻译结束或停止，再修改模型设置。');
  //有请求时，先拒绝改配置
  if(!input || typeof input !== 'object' || typeof input.baseUrl !== 'string' || typeof input.apiKey !== 'string') throw new Error('模型设置无效。');
  const sameAddress = modelConfig && input.baseUrl?.trim().replace(/\/+$/, '') === modelConfig.baseUrl;
  //判断地址有没有变化
  const apiKey = input.apiKey || (sameAddress ? modelConfig.apiKey : '');
  //用户填写了新密钥，就使用新密钥。用户留空，并且地址相同，就沿用本次运行中保存的密钥。用户留空，同时换了地址，就交给后续校验提示重新填写。
  modelConfig = normalizeConfig({ ...input, apiKey });
  //先复制用户输入的属性，再用刚刚确定的 apiKey 覆盖其中的同名属性，最后进行校验。
  return publicSettings();
});
handle('translation:run', async text => {
  if(!modelConfig) throw new Error('请先打开模型设置，填写接口、模型和密钥。');
  if(activeRequest) throw new Error('已有翻译正在处理，请等待或停止。');
  const config = { ...modelConfig};
  const controller = new AbortController(); //用来取消一个正在进行的异步操作
  let timeOut = false;
  activeRequest = controller;
  const timer = setTimeout(() => { timeOut = true; controller.abort();}, 90000);//达到超时时间后，就标记超时并停止等待
  try {
    const result = await translateText(config, text, controller.signal);
    if(controller.signal.aborted) throw new Error('请求已停止。');
    return result;
  } catch (error){
    if (controller.signal.aborted){
      throw new Error(
        timeOut
        ? '等待模型超时，远端可能仍在处理。未自动重试。'
        : '已停止等待，远端可能仍在处理或产生费用。未自动重试。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (activeRequest === controller) activeRequest = null;
  }
});
handle('translation:cancel', () => {
  activeRequest?.abort();
  return true;
});

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 600,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), //	指定页面加载前运行的桥接脚本
      nodeIntegration: false, //页面脚本不直接获得完整 Node.js 能力
      contextIsolation: true, //页面脚本与 preload 使用隔离的 JavaScript 上下文
      sandbox: true, //启用沙箱限制
    }, 
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny'})); //网页请求打开新窗口时，返回拒绝
  mainWindow.webContents.on('will-navigate', event => event.preventDefault()); //监听页面发起的导航，并阻止默认跳转，避免应用页面被替换成其他页面
  mainWindow.loadFile('index.html');
}

//将页面加载到新的 BrowserWindow 实例中

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()} //检查是否已经没有窗口；如果没有，就重新创建。
  })
})

app.on('window-all-closed', () => {
  activeRequest?.abort();
  modelConfig = null;

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

//关闭一个应用的所有窗口后让它退出

