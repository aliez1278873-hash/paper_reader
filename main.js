const { app, BrowserWindow } = require('electron/main')

//导入了两个 Electron 模块：
//app，这个模块控制着您应用程序的事件生命周期。
//BrowserWindow，这个模块创建和管理 app 的窗口。

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 600,
  })

  win.loadFile('index.html')
}

//将页面加载到新的 BrowserWindow 实例中

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()}
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

//关闭一个应用的所有窗口后让它退出

