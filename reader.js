import * as pdfjs from './node_modules/pdfjs-dist/build/pdf.mjs';
// 指定 PDF.js 配套的Worker文件位置，以当前js文件为基准，找到pdf.worker.min.mjs文件
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;
// 1. 引入 PDF.js，设置 Worker 地址

const openButton = document.getElementById('open-pdf'); //对应打开PDF按钮
const fileInput = document.getElementById('pdf-file'); //对应文件选择框
const previousButton = document.getElementById('previous-page'); //对应上一页按钮
const nextButton = document.getElementById('next-page'); //对应下一页按钮
const fileName = document.getElementById('file-name'); //对应文件名显示
const pageLabel = document.getElementById('page-label'); //对应页码显示
const status = document.getElementById('reader-status'); //加载或错误提示
const pageScroll = document.getElementById('page-scroll'); //可滚动阅读区域
const emptyReader = document.getElementById('empty-reader'); //没有显示 PDF 时的占位内容
const emptyTitle = document.getElementById('empty-title'); //占位标题
const emptyDescription = document.getElementById('empty-description'); //标题下的描述
const canvas = document.getElementById('pdf-canvas'); //对应画布页面
// 2. 根据 HTML 的 id 取得页面元素

let pdfDocument = null; // 当前打开的 PDF 文档对象
let currentPage = 0; //当前页码
let busy = false; // 是否正在处理
// 3. 声明 pdfDocument、currentPage、busy

function updateControls() {
  // 根据状态更新按钮和页码

  openButton.disabled = busy; //根据是否正在处理决定是否禁用按钮
  previousButton.disabled = busy || !pdfDocument || currentPage <= 1;
  nextButton.disabled = busy || !pdfDocument || currentPage >= pdfDocument.numPages;
  //这两按钮根据是否正在处理/是否有文件/当前页码是否合法来决定是否禁用（||是短路符，前面成立后面不会执行防止读到null属性报错）
  pageLabel.textContent = pdfDocument ? `${currentPage} / ${pdfDocument.numPages}` : '— / —';
  //使用三元式来决定页码部分的显示，有PDF文件显示当前页码和总页数，没有显示占位符
}

function showError(title, description) {
  // 更新错误显示

  canvas.hidden = true; //隐藏画布
  emptyReader.hidden = false; //显示占位区域
  emptyTitle.textContent = title;
  emptyDescription.textContent = description; 
  status.textContent = description; 
  //写入占位标题和说明
}

async function renderPage(pageNumber) {
  // 取一页 → 计算尺寸 → 绘制 → 显示

  const page = await pdfDocument.getPage(pageNumber); //取得页码对应的PDF页面
  const originalViewport = page.getViewport({ scale: 1 }); //取得这页在缩放比例为 1 时的尺寸信息
  const availableWidth = Math.max(200, pageScroll.clientWidth - 48); //可用宽度，最小取200，-48是因为css中左右边距各为24
  const scale = Math.min(1.5, availableWidth / originalViewport.width); //按可用宽度计算缩放比例，并将最大缩放比例限制为 1.5。
  const viewport = page.getViewport({ scale }); //按计算的比例缩放
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  //devicePixelRatio表示设备物理像素与 CSS 像素的比率，最多按 2 倍准备画布，兼顾清晰度和资源占用

  canvas.width = Math.ceil(viewport.width * pixelRatio);
  canvas.height = Math.ceil(viewport.height * pixelRatio);
  //控制画布内部的实际像素，像素宽度需要是整数，所以ceil向上取整
  canvas.style.width = `${viewport.width}px`; 
  canvas.style.height = `${viewport.height}px`;
  //控制画布在页面中的显示尺寸

  await page.render({ //根据下面参数绘制绘制图像
    canvas, //画布
    canvasContext: canvas.getContext('2d'), // 2D绘图
    viewport, //缩放后的尺寸信息
    transform: [pixelRatio, 0, 0, pixelRatio, 0, 0], //纯缩放矩阵：x 方向放大 pixelRatio 倍，y 方向也放大 pixelRatio 倍
  }).promise; // 等待绘制任务的 promise 完成。

  canvas.setAttribute('aria-label', `PDF第 ${pageNumber} 页`); //更新页面的标签
  canvas.hidden = false; //显示画布
  emptyReader.hidden = true; //隐藏占位区域
  pageScroll.scrollTop = 0; //滚动到顶部
}

async function openPdf(file) {
  // 检查输入 → 读取文件 → 打开文档 → 显示第一页
  // 加上错误处理和收尾

  if(!file || busy) return; //如果没有文件或正在处理就直接返回
  if(!file.name.toLowerCase().endsWith('.pdf')){ //获取文件名并转为小写，检查是否以.pdf结尾
    status.textContent = '请选择 PDF 文件';
    return; //如果不是PDF文件就提示并返回
  }

  busy = true; //标记正在处理
  updateControls(); //更新按钮状态
  status.textContent = '正在打开PDF……'; 
  canvas.hidden = true; //隐藏画布
  let loadingTask; //在外面定义让catch和finally也能访问到，方便在出错时销毁任务

  try {
    //新文件前先重置环境
    const oldDocument = pdfDocument; //保存旧文档的引用
    pdfDocument = null; //置空，避免后续代码误用旧文档
    currentPage = 0; //重置当前页码
    fileName.textContent = file.name; //显示新文件名
    fileName.title = file.name; 
    pageLabel.textContent = '— / —';
    if(oldDocument) await oldDocument.destroy(); //销毁旧文档，释放内存

    const bytes = new Uint8Array(await file.arrayBuffer()); //读取文件为 ArrayBuffer，再创建按字节访问该缓冲区的 Uint8Array 视图
    loadingTask = pdfjs.getDocument({ 
      data: bytes, //把这些 PDF 数据交给 PDF.js，启动一个加载和解析任务
      //下面几个参数，是告诉 PDF.js 去哪里寻找配套资源
      cMapUrl: new URL('./node_modules/pdfjs-dist/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('./node_modules/pdfjs-dist/wasm/', import.meta.url).href,
      isEvalSupported: false, 
    });
    pdfDocument = await loadingTask.promise; //等待PDF加载成功，然后将得到的文档对象保存到pdfDocument
    currentPage = 1;  //打开成功后，显示第一页
    await renderPage(currentPage); //渲染第一页
    status.textContent = ''; //清除界面上的提示
  }catch(error){
    console.error('打开 PDF 失败：', error);
    if(loadingTask) await loadingTask.destroy().catch(() => {}); //如果加载任务存在，销毁释放内存 内层catch是为了防止destroy失败时抛出异常，影响外层catch的执行
    pdfDocument = null;
    currentPage = 0;
    //清空文档状态
    const description = error.name === 'PasswordException' //检查错误名称是不是 PasswordException
      ? '这份 PDF 需要密码，请先选择一份无需密码的 PDF。' //如果是
      : '请确认文件是有效 PDF，然后重新选择文件。'; //如果不是
    showError('暂时无法打开这份 PDF', description); //显示错误
  }finally{
    //结束并重置状态
    busy = false;
    updateControls();
  }
}

async function changePage(offset) {
  // 计算目标页 → 检查边界 → 重新绘制

  if(!pdfDocument || busy) return;
  const targetPage = currentPage + offset; //计算目标页码
  if(targetPage < 1 || targetPage > pdfDocument.numPages) return; //检查目标页码是否合法，如果不合法就直接返回

  busy = true; //标记正在处理
  currentPage = targetPage; //更新当前页码
  updateControls();
  status.textContent = '正在显示页面……';
  try {
    await renderPage(currentPage); //等待绘制完成
    status.textContent = '';
  }catch {
    showError('这一页暂时无法显示', '可以尝试翻到其他页面，或重新打开 PDF。'); //等待的过程中出现错误，跳入错误显示
  }finally {
    busy = false;
    updateControls();
  } //不管成功或失败都重置状态
};

openButton.addEventListener('click', () => fileInput.click()); //监听用户的点击
fileInput.addEventListener('change', async () => {
  await openPdf(fileInput.files[0]);
  fileInput.value = ''; 
}) //用户选好文件后，打开这份PDF；处理结束后，清空文件选择框的记录，让下次可以再次选择同一个文件。
previousButton.addEventListener('click', () => changePage(-1));
nextButton.addEventListener('click', () => changePage(1));
// 4. 最后给按钮和文件选择框安排各自的动作