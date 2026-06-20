## Project Background

Github Repository: `graphif/project-graph`

Project Graph is a desktop application designed to visualize and manage complex project structures. It allows users to create, edit, and visualize project graphs, making it easier to understand relationships and dependencies within projects.

## Coding guidelines

- Prioritize code correctness and clarity. Speed and efficiency are secondary priorities unless otherwise specified.
- Do not write organizational or comments that summarize the code. Comments should only be written in order to explain "why" the code is written in some way in the case there is a reason that is tricky / non-obvious.
- Prefer implementing functionality in existing files unless it is a new logical component. Avoid creating many small files.
- Never silently discard errors with `catch {}` or `catch (e) { console.error(e) }` on fallible operations. Always handle errors appropriately:
  - Don't catch errors, let the calling function to handle them
  - If the error should be ignored, show a dialog instead of logging to console. User cannot see logs in the console.
  - Ensure errors propagate to the top of DOM (eg. `window`), so `ErrorHandler` component can catch it and show an user-friendly dialog
  - Example: avoid `try { something() } catch (e) { console.error(e) }` - use `something()` instead
- Always use `something.tsx` instead of a single `index.tsx` in a directory.
- 项目文件相关动作必须优先扩展 `ProjectRuntimeActions` / runtime adapter，再由 UI 调用语义化动作；不要在菜单、窗口或 service 里直接新增 `@tauri-apps/*` 调用来区分 Desktop/Web。
- 只有 runtime adapter、本地文件系统 provider、Desktop 启动/窗口/快捷键/扩展宿主等明确 Desktop-only 基础设施可以直接使用 `@tauri-apps/*`。新增或移动直接 import 前先运行 `pnpm run audit:tauri-imports`。

## Tech-stack

- React (TypeScript) + Tauri (Rust)
- Vite + pnpm (monorepo) + turborepo
- Canvas 2D
- shadcn/ui + Tailwind CSS + self-developed sub-window system
- Jotai

## Structure

### Tauri Application, and Frontend

- Frontend Vite project: `/app`
- Rust Project: `/app/src-tauri`

### Open-source Libraries

They are all in `/packages` directory, and are used in the frontend.

## Trade time for space

Trade time for space, meaning that you should use more **storage** (not memory!) to reduce computation time

## RFCs

The `tasks` the user refers to are **RFCs**. These RFCs are usually tracked in the repository’s Issues and their titles begin with `RFC:`.

A user **cannot** take on tasks that are irrelevant to their own system. For example, a Linux user **cannot** complete a task that exists only on macOS.

When the user asks which tasks remain unfinished, you must

- assign **a unique number** to every task
- sort the list by a combined score of **importance × implementation difficulty**,
  so the user can easily tell you to tick the finished items in the corresponding RFCs.

## Commit Message

Use conventional commits
