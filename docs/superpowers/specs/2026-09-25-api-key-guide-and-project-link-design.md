# DeepSeek API Key 指引与项目链接设计

## 目标

帮助第一次使用者完成 DeepSeek API Key 配置，同时保持当前单页界面简洁，并在页面底部提供 GitHub 项目入口。

## 方案选择

采用原生折叠指引。相比常驻步骤列表，它默认只占一行；相比弹窗，操作更轻；相比悬浮提示，它在手机和键盘操作下更可靠。

## 页面与交互

- 在 API Key 输入区下方显示折叠入口“没有 API Key？查看获取步骤”。
- 展开后显示四个简短步骤：注册 DeepSeek、充值余额、创建 API Key、将 Key 粘贴到输入框并保存。
- 步骤中的“DeepSeek”链接到 `https://platform.deepseek.com/sign_in`，“充值”链接到 `https://platform.deepseek.com/top_up`，“创建 API Key”链接到 `https://platform.deepseek.com/api_keys`。
- 所有外部链接在新标签页打开，并使用安全的 `rel` 属性。
- 当浏览器已经保存 API Key 时，折叠指引随输入区一起保持隐藏；用户点击“API Key 已保存（点击更换）”并确认后，页面重载，指引重新出现。
- 在现有页脚操作按钮下方添加 GitHub 项目链接，文案为“觉得好用？前往 GitHub 点个 Star ⭐”，链接到 `https://github.com/jmdonbaba/cet6-dictionary`。

## 样式

- 指引沿用现有的次要文字颜色、主色链接和圆角，不新增重型容器。
- 折叠内容采用紧凑的左对齐有序列表；入口仍居中，与顶部输入区保持一致。
- 手机端允许指引宽度随容器收缩，避免横向滚动。
- 页脚项目链接与导入、导出按钮留出少量垂直间距。

## 错误与兼容处理

- 指引使用原生 `details`/`summary`，即使 JavaScript 未运行也可展开。
- 外部页面若要求登录，由 DeepSeek 平台接续处理；本项目不读取或传递用户登录信息。
- 不改变现有 API Key 校验、保存或查询逻辑。

## 验证

- 添加静态页面测试，确认折叠入口、四步指引、三个 DeepSeek 官方链接、保存后隐藏规则以及 GitHub 链接存在。
- 运行全部现有测试，确认原有查词、收藏、表单及移动端样式断言未回归。
- 在浏览器中检查未保存 Key、已保存 Key以及手机宽度下的视觉状态。
