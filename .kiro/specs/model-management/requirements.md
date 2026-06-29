# Requirements Document

## Introduction

「模型管理」(model-management) 特性为已存在的 ModelsPage（`app/web/src/components/ModelsPage.tsx`）补齐规格与测试覆盖。该页面已实现完整的模型管理界面，但没有规格、没有测试，且其业务逻辑全部内联在 React 组件里，未按项目约定抽取为可测试模块。本特性的目标是把 ModelsPage 承载的领域逻辑形式化为需求，并将其抽取为 `app/web/src/lib/*.ts` 下的纯函数模块（每个模块配套 `*.test.ts`，使用 vitest 单元测试与 fast-check 属性测试），使 React 组件保持薄层、跨页状态收敛到 `src/store/uiStore.ts`，与项目既有模块（如 `lib/generationParams.ts`、`lib/promptPreset.ts`、`lib/chatSession.ts`、`lib/voice.ts`）保持一致。

本特性是纯前端特性：后端 REST API（监听 `http://localhost:8080`，经 Vite 代理 `/api`）假定已存在并由前端消费。后端实现、推理引擎、下载执行不在本特性范围内。

本特性覆盖的能力：

1. 浏览本地已安装模型（「我的模型」）：按类型筛选、按最近使用/名称/大小排序，展示名称、类型、大小、量化、来源等。
2. 按模型类型选择/切换当前活跃模型（每类型至多一个），并解析后端返回的当前模型选择。
3. 模型仓库：浏览可下载预设模型，按类型筛选与关键词搜索、按安装状态/大小/名称排序，标识已下载条目。
4. 下载任务：状态机（pending/running/completed/partial_failed/failed/cancelled）、进度聚合、取消/重试/删除任务的可用性规则、活跃任务计数、完成后刷新模型。
5. 删除已安装模型：非 ollama 模型可删除、ollama 模型不可删除，删除前二次确认。
6. 每模型用户备注（可编辑、持久化）与最近使用时间追踪。
7. 系统资源监控：磁盘空间（总量/可用/已用/占用百分比）、GPU 显存、模型总占用，及占用等级分级。
8. 格式化辅助：MB→GB 的大小格式化、字节格式化、相对「最近使用」时间格式化。

本特性不得回归对话、声音工坊、参考音色管理等既有功能，亦不得改变后端 API 契约。

## Glossary

- **Nuwa_Web**: 前端 React 19 + TypeScript + Vite 应用，源码位于 `app/web/src`。
- **Models_Page**: Nuwa_Web 的「模型管理」页面（组件 `ModelsPage`，经 `uiStore.setPage('models')` 进入），含「我的模型」「模型仓库」「下载任务」三个 Tab。
- **Model_Backend**: 已存在的后端 REST 服务，监听 `http://localhost:8080`，经 Vite 代理 `/api`，由 Models_Page 通过 `apiClient` 消费。
- **Model_Logic**: 本特性新增的纯领域逻辑模块集合（位于 `app/web/src/lib`，配套 `*.test.ts`），承载筛选、排序、状态判定、聚合、资源计算与格式化等可测试逻辑。
- **Installed_Model**: 本地已安装模型条目，字段含 `id`、`name`、`model_type`、`path`、`size_mb`、`files`、`main_files`、`description`、`version`、`quant`、`source`。
- **Preset_Model**: 模型仓库预设条目，字段含 `id`、`name`、`model_type`、`description`、`size_mb`、`source`、`repo_id`、`dest_dir`，可选 `note`、`is_downloaded`、`installed_model_id`。
- **Download_Task**: 下载任务，字段含 `id`、`mode`、`status`、`progress`、`speed_mbps`、`total_files`、`completed_files`、可选 `current_file`、`repo_id`、`source`、`dest_dir`、`url`、`dest`、`error`。
- **Model_Type**: 模型类型枚举，取值集合为 `{asr, tts, llm, svs, music, sound, enhance, vad, diarization, speaker, emotion, audio_lm, translation, other}`。
- **Download_Status**: 下载任务状态枚举，取值集合为 `{pending, running, completed, partial_failed, failed, cancelled}`。
- **Active_Status_Set**: Download_Status 的子集 `{pending, running}`，表示进行中的任务。
- **Done_Status_Set**: Download_Status 的子集 `{completed, partial_failed, failed, cancelled}`，表示已结束的任务。
- **Active_Model_Map**: 形如 `Record<Model_Type, model_id>` 的映射，表示每个 Model_Type 当前选中的模型，键至多对应一个模型 `id`。
- **Model_Meta**: 单个模型的元数据，字段含 `notes`（备注字符串）、`tags`（字符串数组）、可选 `last_used`（Unix 秒级时间戳）。
- **Disk_Info**: 磁盘信息，字段含 `total_bytes`、`free_bytes`、`used_bytes`、`used_percent` 及对应文本字段。
- **Gpu_Info**: GPU 信息，字段含 `name`、`total_vram_mb`、`used_vram_mb`、`free_vram_mb`、`usage_percent`。
- **Usage_Level**: 资源占用等级，依据占用百分比分为 `high`（> 90）、`medium`（> 75 且 ≤ 90）、`normal`（≤ 75）。
- **Ollama_Model**: `source` 等于 `ollama` 的 Installed_Model。
- **Models_Endpoint**: `GET /api/models`，返回 Installed_Model 列表。
- **Scan_Endpoint**: `POST /api/models/scan` 触发扫描，`GET /api/models/scan-progress` 返回 `{ scanning: boolean }`。
- **Config_Endpoint**: `GET /api/config`，返回当前模型选择字段（`current_models` 映射、兼容旧字段 `current_asr_model`/`current_tts_model`/`current_llm_model`）与 `model_meta`。
- **Set_Model_Endpoint**: `POST /api/config/set-model`，请求体 `{ model_type, model_id }`，返回更新后的配置。
- **Delete_Model_Endpoint**: `DELETE /api/models/{id}`，删除指定 Installed_Model。
- **Meta_Endpoint**: `GET`/`POST /api/models/{id}/meta`，读取/保存某模型的 Model_Meta。
- **Presets_Endpoint**: `GET /api/downloads/presets` 返回 Preset_Model 列表；`POST /api/downloads/presets/refresh` 刷新仓库列表。
- **Downloads_Endpoint**: `GET /api/downloads` 返回 Download_Task 列表；`POST /api/downloads` 与 `POST /api/downloads/batch` 创建下载；`POST /api/downloads/{id}/cancel`、`POST /api/downloads/{id}/retry`、`DELETE /api/downloads/{id}` 分别取消、重试、删除任务。
- **System_Endpoints**: `GET /api/system/disk` 返回 Disk_Info；`GET /api/system/gpu` 返回 Gpu_Info 或空。

## Requirements

### Requirement 1: 浏览与筛选本地已安装模型

**User Story:** 作为女娲用户，我想浏览本地已安装模型并按类型筛选、按不同维度排序，以便快速找到目标模型。

#### Acceptance Criteria

1. WHEN Models_Page 进入「我的模型」Tab，THE Models_Page SHALL 通过 Models_Endpoint 获取 Installed_Model 列表并展示每个 Installed_Model 的 `name`、`model_type` 对应标签、`size_mb`、`quant` 与 `source`。
2. WHILE Models_Endpoint 请求处于等待响应状态，THE Models_Page SHALL 显示模型列表加载中的状态。
3. WHEN 用户选择类型筛选为某个 Model_Type，THE Model_Logic SHALL 返回 `model_type` 等于该 Model_Type 的 Installed_Model 子集。
4. WHEN 用户选择类型筛选为「全部」，THE Model_Logic SHALL 返回与输入等长且元素相同的 Installed_Model 集合。
5. WHEN 用户选择排序方式为「名称」，THE Model_Logic SHALL 按 `name` 升序返回 Installed_Model 列表。
6. WHEN 用户选择排序方式为「大小: 大到小」或「大小: 小到大」，THE Model_Logic SHALL 分别按 `size_mb` 降序或升序返回 Installed_Model 列表。
7. WHEN 用户选择排序方式为「最近使用」，THE Model_Logic SHALL 按对应 Model_Meta 的 `last_used` 降序返回 Installed_Model 列表，并对 `last_used` 相等或缺失的条目按 `name` 升序排列。
8. WHEN Model_Logic 对 Installed_Model 列表执行筛选或排序，THE Model_Logic SHALL 使输出列表的元素集合是输入列表元素集合的子集，且不新增、不重复输入中不存在的元素。
9. WHEN 用户触发重新扫描，THE Models_Page SHALL 调用 Scan_Endpoint 并轮询扫描进度，且在 `scanning` 变为 `false` 后重新获取 Installed_Model 列表。

### Requirement 2: 选择每类型的当前活跃模型

**User Story:** 作为女娲用户，我想为每个模型类型设置当前使用的模型，以便系统在推理时使用我指定的模型。

#### Acceptance Criteria

1. WHEN Models_Page 获取到 Config_Endpoint 响应，THE Model_Logic SHALL 解析出 Active_Model_Map，其中每个存在选择的 Model_Type 映射到唯一的模型 `id`。
2. WHERE Config_Endpoint 同时返回 `current_models` 映射与旧字段 `current_asr_model`/`current_tts_model`/`current_llm_model`，THE Model_Logic SHALL 以 `current_models` 中对应类型的值为准解析 Active_Model_Map。
3. WHEN Model_Logic 解析 Active_Model_Map，THE Model_Logic SHALL 排除值为 `null`、`undefined` 或空字符串的类型，使 Active_Model_Map 仅包含有有效模型 `id` 的 Model_Type。
4. THE Model_Logic SHALL 使 Active_Model_Map 中每个 Model_Type 至多对应一个模型 `id`。
5. WHEN 用户对某个 Installed_Model 触发「使用」，THE Models_Page SHALL 调用 Set_Model_Endpoint 并提交该模型的 `model_type` 与 `id`。
6. WHEN Set_Model_Endpoint 返回成功，THE Models_Page SHALL 以返回的配置更新当前模型回显，使该 Model_Type 的活跃模型标识指向新选择的模型 `id`。
7. IF 某个 Model_Type 当前选中的模型 `id` 不存在于已加载的 Installed_Model 列表中，THEN THE Models_Page SHALL 不为该 Model_Type 渲染活跃模型卡片。

### Requirement 3: 浏览、搜索与筛选模型仓库

**User Story:** 作为女娲用户，我想在模型仓库中按类型筛选、按关键词搜索并排序预设模型，以便发现并选择要下载的模型。

#### Acceptance Criteria

1. WHEN Models_Page 进入「模型仓库」Tab，THE Models_Page SHALL 通过 Presets_Endpoint 获取 Preset_Model 列表并对每个已安装条目（`is_downloaded` 为真）展示「已下载」标识。
2. WHEN 用户输入搜索关键词，THE Model_Logic SHALL 返回 `name`、`description` 或 `note` 中以不区分大小写方式包含该关键词的 Preset_Model 子集。
3. WHEN 搜索关键词为空字符串，THE Model_Logic SHALL 返回未被搜索过滤的 Preset_Model 集合。
4. WHEN 用户选择类型筛选为某个 Model_Type，THE Model_Logic SHALL 返回 `model_type` 等于该 Model_Type 的 Preset_Model 子集；WHEN 用户选择「全部」，THE Model_Logic SHALL 不按类型过滤。
5. WHEN 用户选择排序方式为「已安装优先」，THE Model_Logic SHALL 将 `is_downloaded` 为真的 Preset_Model 排在为假的之前，并在同一安装状态内按 `name` 升序排列。
6. WHEN 用户选择排序方式为「大小: 大到小」、「大小: 小到大」或「名称」，THE Model_Logic SHALL 分别按 `size_mb` 降序、`size_mb` 升序或 `name` 升序返回 Preset_Model 列表。
7. WHEN Model_Logic 对 Preset_Model 列表执行搜索、筛选与排序的任意组合，THE Model_Logic SHALL 使输出条目数不超过输入条目数，且输出元素均来自输入集合。
8. WHEN 用户触发刷新仓库列表，THE Models_Page SHALL 调用 Presets_Endpoint 的刷新接口并重新获取 Preset_Model 列表。

### Requirement 4: 下载任务的状态、进度与操作

**User Story:** 作为女娲用户，我想查看下载任务的状态与进度并对其取消、重试、删除，以便管理模型下载过程。

#### Acceptance Criteria

1. WHILE Models_Page 处于挂载状态，THE Models_Page SHALL 以 2 秒为间隔通过 Downloads_Endpoint 轮询 Download_Task 列表并展示每个任务的 `status`、`progress` 与（批量任务的）`completed_files`/`total_files`。
2. WHEN Models_Page 卸载，THE Models_Page SHALL 停止对 Downloads_Endpoint 的轮询。
3. WHEN Model_Logic 计算用于展示的任务进度，THE Model_Logic SHALL 返回限定在 `0` 到 `100` 闭区间内的进度值。
4. THE Model_Logic SHALL 判定一个 Download_Task 的 `status` 属于 Active_Status_Set 时为「进行中」，属于 Done_Status_Set 时为「已结束」。
5. WHEN Model_Logic 判定取消操作的可用性，THE Model_Logic SHALL 仅当 Download_Task 的 `status` 属于 Active_Status_Set 时返回可取消。
6. WHEN Model_Logic 判定重试操作的可用性，THE Model_Logic SHALL 仅当 Download_Task 的 `status` 为 `failed` 或 `partial_failed` 时返回可重试。
7. WHEN Model_Logic 判定删除操作的可用性，THE Model_Logic SHALL 仅当 Download_Task 的 `status` 属于 Done_Status_Set 时返回可删除。
8. WHEN Model_Logic 统计活跃任务数量，THE Model_Logic SHALL 返回 `status` 属于 Active_Status_Set 的 Download_Task 数量。
9. WHEN 用户对一个可取消任务触发取消、对一个可重试任务触发重试、或对一个可删除任务触发删除，THE Models_Page SHALL 分别调用 Downloads_Endpoint 的取消、重试、删除接口，并随后刷新 Download_Task 列表。
10. WHEN 一个 Download_Task 的 `status` 由非 `completed` 变为 `completed`，THE Models_Page SHALL 重新获取 Installed_Model 列表。
11. WHEN 一个批量 Download_Task 的 `total_files` 大于 `0`，THE Model_Logic SHALL 使 `completed_files` 不超过 `total_files`。

### Requirement 5: 删除已安装模型

**User Story:** 作为女娲用户，我想删除不再需要的本地模型，但避免误删由 Ollama 管理的模型，以便安全地释放磁盘空间。

#### Acceptance Criteria

1. WHEN Model_Logic 判定某个 Installed_Model 的可删除性，THE Model_Logic SHALL 仅当该模型不是 Ollama_Model 时返回可删除。
2. WHERE 某个 Installed_Model 是 Ollama_Model，THE Models_Page SHALL 不为该模型展示删除控件。
3. WHEN 用户对某个非 Ollama_Model 触发删除，THE Models_Page SHALL 先展示二次确认提示，且在用户确认前不调用 Delete_Model_Endpoint。
4. WHEN 用户在二次确认提示中确认删除，THE Models_Page SHALL 调用 Delete_Model_Endpoint 并传入该模型的 `id`。
5. IF 用户在二次确认提示中取消删除，THEN THE Models_Page SHALL 保留该模型且不调用 Delete_Model_Endpoint。
6. WHEN Delete_Model_Endpoint 返回成功，THE Models_Page SHALL 从展示列表中移除该 Installed_Model，并刷新当前模型选择回显与磁盘信息。

### Requirement 6: 模型备注与最近使用时间

**User Story:** 作为女娲用户，我想为模型添加可保存的备注并看到最近使用时间，以便记录与识别每个模型的用途。

#### Acceptance Criteria

1. WHEN 用户打开某个 Installed_Model 的详情，THE Models_Page SHALL 通过 Meta_Endpoint 获取该模型的 Model_Meta 并展示其 `notes`。
2. WHEN 用户编辑某个模型的备注并保存，THE Models_Page SHALL 通过 Meta_Endpoint 提交 `notes` 并以返回的 Model_Meta 更新展示。
3. WHEN Meta_Endpoint 成功返回保存后的 Model_Meta，THE Models_Page SHALL 使该模型展示的备注与提交的 `notes` 一致。
4. WHERE 某个 Installed_Model 的 Model_Meta 含 `last_used`，THE Model_Logic SHALL 依据当前时间与 `last_used` 的差值产生相对时间文案。
5. WHEN 当前时间与 `last_used` 的差值小于 60 秒，THE Model_Logic SHALL 产生「刚刚使用」文案。
6. WHEN 该差值大于等于 60 秒且小于 3600 秒，THE Model_Logic SHALL 产生以整分钟数表示的「N 分钟前」文案。
7. WHEN 该差值大于等于 3600 秒且小于 86400 秒，THE Model_Logic SHALL 产生以整小时数表示的「N 小时前」文案。
8. WHEN 该差值大于等于 86400 秒，THE Model_Logic SHALL 产生以整天数表示的「N 天前」文案。

### Requirement 7: 系统资源监控与占用统计

**User Story:** 作为女娲用户，我想查看磁盘空间、GPU 显存与模型总占用，以便在下载或删除模型前评估资源。

#### Acceptance Criteria

1. WHEN Models_Page 进入「我的模型」Tab，THE Models_Page SHALL 通过 System_Endpoints 获取 Disk_Info 与 Gpu_Info 并展示磁盘已用百分比与（若存在 Gpu_Info）显存使用百分比。
2. WHEN Model_Logic 计算已安装模型总占用，THE Model_Logic SHALL 返回所有 Installed_Model 的 `size_mb` 之和。
3. WHEN 已安装模型列表为空，THE Model_Logic SHALL 使已安装模型总占用为 `0`。
4. WHEN Model_Logic 依据占用百分比判定 Usage_Level，THE Model_Logic SHALL 在百分比大于 90 时返回 `high`、在大于 75 且小于等于 90 时返回 `medium`、在小于等于 75 时返回 `normal`。
5. IF System_Endpoints 请求失败或返回空 Gpu_Info，THEN THE Models_Page SHALL 不展示对应资源条且不中断「我的模型」其余内容的展示。

### Requirement 8: 大小与字节格式化

**User Story:** 作为女娲用户，我想看到统一且易读的容量数值，以便理解模型大小与磁盘占用。

#### Acceptance Criteria

1. WHEN Model_Logic 格式化以 MB 为单位的数值且该数值大于 1024，THE Model_Logic SHALL 返回以 GB 为单位、保留 1 位小数的文本。
2. WHEN Model_Logic 格式化以 MB 为单位的数值且该数值大于等于 100 且小于等于 1024，THE Model_Logic SHALL 返回以 MB 为单位、保留 0 位小数的文本。
3. WHEN Model_Logic 格式化以 MB 为单位的数值且该数值小于 100，THE Model_Logic SHALL 返回以 MB 为单位、保留 1 位小数的文本。
4. WHEN Model_Logic 格式化以字节为单位的数值，THE Model_Logic SHALL 在数值大于等于 1073741824 时返回 GB、大于等于 1048576 时返回 MB、大于等于 1024 时返回 KB、否则返回以 B 为单位的文本，且 GB/MB/KB 文本保留 1 位小数。
5. WHEN Model_Logic 对一个非负数值执行大小或字节格式化，THE Model_Logic SHALL 返回包含数值与单位标识的非空文本。

### Requirement 9: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想在请求失败时得到清晰反馈，并确保既有功能不被破坏，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. IF 对 Models_Endpoint、Presets_Endpoint 或 Meta_Endpoint 的请求发生网络错误或返回非成功响应，THEN THE Models_Page SHALL 展示错误提示并退出对应区域的加载状态。
2. IF 对 Set_Model_Endpoint、Delete_Model_Endpoint 或 Downloads_Endpoint 的操作请求返回错误响应，THEN THE Models_Page SHALL 展示错误提示且不更新对应展示状态为成功结果。
3. WHEN 本特性将 ModelsPage 的领域逻辑抽取为 Model_Logic 模块，THE Models_Page SHALL 保持与抽取前一致的可观察行为（筛选、排序、状态判定、聚合、资源计算与格式化的结果不变）。
4. THE Nuwa_Web SHALL 在本特性变更后保持对话功能（`/api/chat`）可正常使用。
5. THE Nuwa_Web SHALL 在本特性变更后保持声音工坊与参考音色管理功能（`/api/voices*`、`/api/inference/*`）可正常使用。
6. THE Nuwa_Web SHALL 在本特性变更后保持 Config_Endpoint 与 Set_Model_Endpoint 的请求契约不变，使依赖当前模型选择的其他页面不回归。
