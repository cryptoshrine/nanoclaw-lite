---
name: task
description: Manage the Ball-AI pending task list. Add, update, complete, or list tasks.
argument-hint: 'list, add [description], done [number], update [number] [changes], status [number] [new status], priority [number] [new priority]'
allowed-tools: Read, Write, Edit, Bash
---

# Task Management Skill

Manage the Ball-AI pending task list stored at `tasks/ball-ai-pending-tasks.md`.

## Commands

Parse the `$ARGUMENTS` to determine which action to take:

### `/task list` (or no arguments)
1. Read `tasks/ball-ai-pending-tasks.md`
2. Display a summary grouped by status:
   - **Completed** — count only (e.g., "7 tasks completed")
   - **Pending** — show each with number, title, priority, size
   - **In Progress** — show each with number, title, priority, size
3. Format for messaging (no markdown headings, use *bold* and bullets)

Example output:
```
📋 *Ball-AI Tasks*

✅ 7 completed

🔄 *In Progress:*
• None currently

📝 *Pending (9):*
• #8 xG+ / Expected Shots (xS) — P1, Large
• #9 Voronoi "Control of Space" Viz — P1, Medium
• #10 One-Click Social Cards from Live Data — P2, Small
• #11 xG Timeline Storytelling — P2, Small
• #12 World Cup 2026 Toolkit — P1, Large
• #13 "Decision Quality" Index — P2, Large
• #14 "Pressure Resilience" Profiles — P2, Medium
• #15 Set Piece Playbook Reconstruction — P3, Medium
• #16 Cross-League Player Archetypes — P3, Medium
```

### `/task add [description]`
1. Read the task file
2. Find the highest task number
3. Append a new task section with:
   - Next sequential number
   - Status: Pending
   - Priority: Medium (P2) unless specified
   - Added date: today
   - The provided description as summary
4. Write the updated file

### `/task done [number]`
1. Read the task file
2. Find the task by number
3. Change its status to "Completed ✓"
4. Add completed date: today
5. Write the updated file
6. Confirm the change

### `/task update [number] [changes]`
1. Read the task file
2. Find the task by number
3. Apply the described changes to the task section
4. Write the updated file
5. Confirm what was changed

### `/task status [number] [new status]`
1. Read the task file
2. Find the task by number
3. Update the status field
4. Write the updated file

### `/task priority [number] [new priority]`
1. Read the task file
2. Find the task by number
3. Update the priority field
4. Write the updated file

### `/task remove [number]`
1. Read the task file
2. Find and remove the task section
3. Write the updated file
4. Confirm removal

## Important Notes
- The task file may be a symlink to `groups/main/tasks/ball-ai-pending-tasks.md` — that's fine, read/write through it normally.
- Always preserve the existing format and structure of the file.
- After any modification, briefly confirm what was done.
- Use messaging-friendly formatting (no ## headings, use *bold* with single asterisks).
