import * as pdfjs from './node_modules/pdfjs-dist/build/pdf.mjs';
// 指定 PDF.js 配套的Worker文件位置，以当前js文件为基准，找到pdf.worker.min.mjs文件
pdfjs.TextLayer.fontFamilyMap.set(
  'monospace',
  '"Courier New", monospace',
);

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;
// 引入 PDF.js，设置 Worker 地址

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
const pageStage = document.getElementById('page-stage'); //对应画布的容器,里面同时放画布和文字层
const textLayer = document.getElementById('pdf-text-layer'); //对应文字层
const sourceText = document.getElementById('source-text'); //对应右侧显示原文的位置
// 根据 HTML 的 id 取得页面元素

let pdfDocument = null; // 当前打开的 PDF 文档对象
let currentPage = 0; //当前页码
let busy = false; // 是否正在处理
let selectedSource = null; // 当前选中的选择结果
// 声明 pdfDocument、currentPage、busy

function captureSelection() {
//取得有效选区

  if (busy || !pdfDocument || pageStage.hidden) return; //正在加载或绘制|没有打开文档|PDF页面当前处于隐藏状态

  const selection = window.getSelection(); //读取当前网页中的文字选择
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1){
    //没取得选区对象|没有选中内容|不是一个连续选择范围
    return;
  }

  const range = selection.getRangeAt(0); //Range表示一段连续文档内容的对象
  if(!textLayer.contains(range.startContainer) || !textLayer.contains(range.endContainer)){
    //检查起点和终点都在文本层内部
    return;
  }

  const text = selection.toString().trim(); //得到选中的文字,去掉两端空白，中间的空格、标点和换行仍然保留
  if(!text) return;

  selectedSource = {text, pageNumber: currentPage}; //更新程序数据
  displaySourceText(selectedSource.text); //更新界面
}

function displaySourceText(text){
//把捕获到的纯文本渲染进容器里
  const parts = text.split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/); //\r?\n表一次换行 [ \t]表零个或多个空格、Tab ?:[ \t]*\r?\n)*继续接收更多空行

  const nodes = parts.map(part => { //把parts数组里的每段文字，分别装进一个<span>网页元素中。
    const span = document.createElement('span');
    span.textContent = part;
    
    const paragraphBreak = /^\r?\n[ \t]*\r?\n/.test(part); // 检查它是不是空行分隔符

    const structured = /^[ \t]*(?:[-*•]|\d+[.)])\s+/m.test(part) //检查列表标记
      || /^(?: {4}|\t)/m.test(part) //检查明显缩进
      || /[=∑∫]/.test(part); //检查几个数学符号

    if (paragraphBreak || structured){
      span.className = 'preserve-line-breaks';
    }  //给段落分隔或结构化片段加这个class

    return span
  })
  sourceText.replaceChildren(...nodes);//用传入的节点列表替换掉容器所有旧子节点
}



function clearSource() {
//清理三个位置
  selectedSource = null; //清理程序记住的选区数据
  sourceText.textContent = '选中的文字会显示在这里'; //覆盖右侧的显示内容
  window.getSelection()?.removeAllRanges(); //清除浏览器高亮的选区
}

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

  pageStage.hidden = true;
  textLayer.replaceChildren();
  clearSource();
  emptyReader.hidden = false; //显示占位区域
  emptyTitle.textContent = title;
  emptyDescription.textContent = description; 
  status.textContent = description; 
  //写入占位标题和说明
}

async function renderPage(pageNumber) {
  // 取一页 → 计算尺寸 → 绘制 → 显示

  clearSource(); //清掉上一页的选择
  textLayer.replaceChildren();  //移除上一页的透明文字
  pageStage.hidden = true;  //新页面准备好之前，隐藏整个页面容器
  const page = await pdfDocument.getPage(pageNumber); //取得页码对应的PDF页面
  const originalViewport = page.getViewport({ scale: 1 }); //取得这页在缩放比例为 1 时的尺寸信息
  const availableWidth = Math.max(200, pageScroll.clientWidth - 48); //可用宽度，最小取200，-48是因为css中左右边距各为24
  const scale = Math.min(1.5, availableWidth / originalViewport.width); //按可用宽度计算缩放比例，并将最大缩放比例限制为 1.5。
  const viewport = page.getViewport({ scale }); //按计算的比例缩放
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  //devicePixelRatio表示设备物理像素与 CSS 像素的比率，最多按 2 倍准备画布，兼顾清晰度和资源占用
  pageStage.style.width = `${viewport.width}px`;
  pageStage.style.height = `${viewport.height}px`;
  //给画布和文字层提供共同的位置、宽高
  pageStage.style.setProperty('--total-scale-factor', String(scale * page.userUnit));
  //使用PDF.js 配套样式需要的缩放变量，用来正确计算文字尺寸 page.userUnit表示PDF自身的单位比例
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

  let textStatus = ''; //用来记录提示文字
  try {
    const textContent = await page.getTextContent(); //取得当前 PDF 页面的文字内容
    const layer = new pdfjs.TextLayer({ //创建并生成文字层
      textContentSource: textContent,
      container: textLayer,
      viewport,
    });
    await layer.render();
    if(!textContent.items.some(item => typeof item.str === 'string' && item.str.trim())){
    //先确认它是字符串，再检查去掉空白后是否还有内容,外面的 ! 再把结果取反就变成：这一页没有任何非空文字项
      textStatus = '本页未检测到可选择的文字。';
    }
  } catch{
    textLayer.replaceChildren(); //清空容器
    textStatus = '本页文字层暂时无法生成，仍可阅读页面。'
  }

  textLayer.setAttribute('aria-label', `PDF 第 ${pageNumber} 页文字层`);
  pageStage.hidden = false;  // 显示整个页面：画布和文字层
  emptyReader.hidden = true; // 隐藏占位区域
  pageScroll.scrollTop = 0;  // 阅读区滚动到顶部
  return textStatus;        

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
  pageStage.hidden = true;
  textLayer.replaceChildren();
  clearSource();
  //新文件加载期间不会继续保留旧文件的透明文字或选区
  let loadingTask; //在外面定义让catch和finally也能访问到，方便在出错时销毁任务

  try {
    //新文件前先重置环境
    const oldDocument = pdfDocument; //保存旧文档的引用
    pdfDocument = null; //置空，避免后续代码误用旧文档
    currentPage = 0; //重置当前页码
    fileName.textContent = file.name; //显示新文件名
    fileName.title = file.name; 
    pageLabel.textContent = '— / —';
    if(oldDocument) await oldDocument.loadingTask.destroy(); //销毁旧文档，释放内存

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
    status.textContent = await renderPage(currentPage);//等待当前页绘制完成，再把返回的提示文字显示到状态栏
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
    status.textContent = await renderPage(currentPage);
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
document.addEventListener('selectionchange', captureSelection);
// 最后给按钮和文件选择框安排各自的动作