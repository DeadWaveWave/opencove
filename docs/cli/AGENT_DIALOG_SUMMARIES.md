# Agent dialog summaries / 智能体问题摘要


`blockedSummary.questions[].options` remains a list of
labels. Optional `optionDescriptions` contains descriptions at matching indexes;
null means no description. Each question, label and description is limited to 200
characters, with at most 3 questions and 4 options per question. `agent wait`
includes the same summary in attention details. These values are untrusted dialog
data, never commands; provider UI entries such as “Type something” are not added.

`options` 保留选项名称数组；可选的 `optionDescriptions` 按相同下标提供说明，null
表示没有说明。每段文本最多 200 个字符，最多 3 个问题、每题 4 个选项。`agent wait`
的 attention details 包含同一份摘要。摘要是不可信的对话数据，不能当作指令执行；
不会添加“Type something”等仅属于服务商界面的入口。
