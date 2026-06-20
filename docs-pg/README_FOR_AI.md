# 项目介绍

这是一个绘制网状节点图的工具。目前采用json存储数据工程文件。

## 技术栈

基于 Tauri 框架，TypeScript + React + Rust。其中Rust只负责基础的本地文件处理部分，绝大部份功能由前端完成。

前端UI采用 tailwindcss 完成。

使用 monorepo 管理项目，主要分为 app（应用程序本体） 和 docs（软件官网） 两个部分。

使用 pnpm 作为包管理工具。

## 运行时边界

当前 fork 正在把 Desktop/Web/CLI 的项目操作收敛到后端优先模型。新增“打开、保存、备份、导入、导出、引用、文件夹扫描”等项目语义动作时，先扩展 `app/src/core/runtime/ProjectRuntimeActions.ts` 或对应后端 API，再让 UI 调 adapter。

不要在菜单、窗口、普通 service 中直接新增 `@tauri-apps/*` 调用来绕过 Web 端。允许直接使用 Tauri 的位置仅限 runtime adapter、本地文件系统 provider、Desktop 启动/窗口/快捷键/扩展宿主等明确 Desktop-only 基础设施。提交前运行 `pnpm run audit:tauri-imports`，未分类的 Tauri import 必须迁入 adapter 或登记为迁移债。

## 代码要求

rust中的函数提供给前端调用，函数在运行中绝对不能出现报错，必须要保证函数内部捕获所有可能出现的错误，函数的健壮性。否则会导致程序直接闪退
