# もごもご录音页：GitHub Pages 备用版

独立的纯静态公开版，保留15句原稿、振假名、日语指引、H/M录音、回听、重录、选用版本、自评和ZIP导出。当前无登录限制，无Google Drive自动上传。页面部署与录音都不需要把原研究工程上传到GitHub。

## 公开范围

- **公开网页不是私密网页**。即使没有把链接发给别人，也可能被访问。本项目含 `noindex` 和 `robots.txt`，只是请求搜索引擎不收录，不提供访问控制。
- 用户于2026-10-01明确允许公开参考006，因此本版本包含 `site/assets/reference006.wav`，供所有访问者试听或下载。不包含其他真实音频、参考录音转写、员工姓名、公司信息、私有Drive链接、OAuth密钥或参与者录音。
- 「参考音声」默认加载006。仍可在本机选择其他音频，也可点击「006に戻す」。本机选择的音频不上传，刷新后恢复006。每个录音版本记录参考来源及SHA256；参考音频不会混入录制者导出的ZIP。
- 录音保存在当前浏览器的IndexedDB中，结束后手动导出WAV和配对清单ZIP。不同电脑、浏览器、站点地址不会自动同步。
- 页面自身没有统计追踪或录音上传请求；网站托管方仍可能记录访问IP等常规访问日志。
- 只使用匿名话者ID。此备用版不替代正式实验的参与者告知和授权流程。

## 发布到 github.io

1. 为 `WangRui-debug` 新建独立仓库 `mogomogo-recorder`，不修改现有的 `WangRui-debug.github.io` 主页仓库。不要上传原始研究目录或其他便携包。普通GitHub Free账号可使用公开仓库部署。
2. 将**本目录内容**作为仓库根目录，包括 `.github/workflows/pages.yml`，保留 `site/` 子目录。
3. 在仓库 `Settings > Pages > Build and deployment` 中，选择 **GitHub Actions**。
4. 打开 `Actions > Publish Recording Backup > Run workflow`，手动发布。本项目不会因为普通push自动重新发布。
5. 工作流成功后，站点地址显示在该次部署结果中。项目站点通常是 `https://你的用户名.github.io/仓库名/`。本项目发布成功后的预期地址是 `https://wangrui-debug.github.io/mogomogo-recorder/`；这是预期地址，不代表已经上线。页面采用相对路径，支持这一子目录形式。

只有GitHub部署实际成功，网址才可访问。本地完成页面不等于已经上线。无需在GitHub Secrets中设置Google或Drive凭证，勿将任何凭证放进纯静态网页。

`site/` 是唯一发布内容。工作流会检查固定文件清单，只允许经过SHA256校验的006参考音频，拒绝其他额外音频、意外加入的文件和符号链接。该检查是防止误传的辅助措施，不是全面的机密信息审计；发布前仍应查看仓库内容。

## 本地试听与测试

```bash
python3 preview.py --port 8766
```

打开 `http://localhost:8766/preview/`。若运行在远程服务器，先把8766端口转发到自己的电脑；这是本地预览，不是公开网址。原录音页使用的8765端口不受影响。

验证文件和打包：

```bash
python3 tools/verify_public.py
python3 tools/package.py
```

独立的浏览器测试需要Playwright，使用模拟麦克风和人工生成的替换参考音，同时检查默认006可加载、播放和恢复：

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tools/test_public.py --url http://localhost:8766/preview/
```

采集格式为PCM16单声道WAV，采用浏览器实际采样率，不额外归一化或去静音。H/M是同文本配对，不是逐帧对齐。参考加载、播放、录音与导出应在正式收录电脑上另外试用一次。

## 官方文档

- [GitHub Pages的HTTPS与公开可见性](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [GitHub Pages自定义发布工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

本公开备用版与受控登录、自动Drive收录版相互独立。今后增加自动上传时，应另配后端认证和授权，不在前端存放管理员凭证。
