# もごもご录音页：GitHub Pages 版

日语收录页面：15句原稿与振假名、H/M录音、回听、重录、选用、自评、实时频谱及ZIP导出。

## 参考音频政策

自2026-10-09起，本工具不提供、加载或打包参考音频，页面不设置试听或参考文件选择入口。录制者按照文字指引与担当者练习。15句录制文本未变；旧会话仍可打开和导出，导出时不再附带旧参考来源字段。

当前网页及下载包不含参考录音，但撤下文件不能回收他人已下载的副本或浏览器缓存。旧公开仓库历史及旧发布产物需要单独处理，不能仅凭当前文件删除就认定全部撤回。

## 使用与数据保存

- 网址：https://wangrui-debug.github.io/mogomogo-recorder/
- 录音仅保存在当前浏览器IndexedDB，不自动上传服务器或Drive；完成后手动下载ZIP交给担当者。
- 使用匿名话者ID。清除浏览器数据前务必导出录音。
- 页面没有登录限制；noindex不构成访问控制。部署项目仅包含site目录。
- 普通发话与もごもご为同文本配对，不是逐帧对齐。PCM16单声道，采用浏览器实际采样率，不额外归一化或去静音。

## 预览、测试与发布

```bash
python3 preview.py --port 8766
python3 tools/verify_public.py
python3 tools/test_public.py --url http://localhost:8766/preview/
python3 tools/package.py
```

本地预览：http://localhost:8766/preview/。远程服务器需要端口转发。浏览器测试依赖Playwright Chromium，使用人工测试音与模拟麦克风，不使用真实参考录音。

GitHub Actions的Publish Recording Backup为手动工作流，push后需要手动运行pages.yml。发布检查采用文件白名单，不允许附带任何录音文件。更新app.js、spectrum.js或样式时，应同步更新index.html里的版本参数，避免混用缓存脚本。

## 实时频谱

连接麦克风后显示实时波形、音量以及可切换的频谱曲线和6秒滚动声谱图。使用原生AnalyserNode，FFT大小2048、平滑0.25、最高30次/秒，显示范围0至8kHz（不超过实际Nyquist频率）。

显示为数字FFT幅度，不是校准声压级或もごもご评分。分析不修改PCM录音，也不进入导出ZIP。断开麦克风清空显示；停止录音但仍连接麦克风时继续显示输入。
