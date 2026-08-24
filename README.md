# CET-6 查词助手

- 结合我自身六级搜词需求，适合六级宝宝体质的搜词器。
- 独立的 CET-6 英语查词工具，从 [Cet6Writing](../Cet6Writing) 项目中剥离，单独优化，之后再并入。

## 功能

- **AI 查词**：输入单词或短语，调用 DeepSeek API 返回释义、音标、词性、变形、学术例句
- **变形还原**：自动识别过去式、现在分词等变形，显示原形结果
- **多窗口查词**：支持 +/− 按钮添加/删除多个查词窗口，可同时查询多个单词
- **词汇收藏**：收藏感兴趣的词汇，支持置顶、查看详情、删除
- **共享收藏**：与原 Cet6Writing 项目共享 `localStorage` 中的词汇收藏数据

## 技术栈

- 纯前端 HTML/CSS/JS（无依赖）
- DeepSeek API（deepseek-v4-flash）
- localStorage 数据持久化

## 与Cet6Writing的关系

- 共享 `cet6_api_key` — API Key 两个项目只需配置一次
- 共享 `cet6_vocab_favorites` — 任一项目中收藏/删除的词汇会自动同步
- 不包含作文生成功能，纯查词+收藏

## 使用方式

- **在线使用**：https://jmdonbaba.github.io/cet6-dictionary/
- **本地使用**：直接用浏览器打开 `index.html` 即可使用。
