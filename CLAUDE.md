# CLAUDE.md - Claude Code 项目指南

## 项目概述

open-nof1.ai 是一个 AI 驱动的加密货币自动交易系统，将大语言模型智能与量化交易实践深度融合。系统基于 VoltAgent 框架构建，通过赋予 AI 完全的市场分析和交易决策自主权，实现真正的智能化交易。

## 技术栈

- **框架**: [VoltAgent](https://voltagent.dev) - AI Agent 编排与管理
- **AI 提供商**: OpenAI 兼容 API (OpenRouter, OpenAI, DeepSeek)
- **交易所**: Gate.io / OKX (支持测试网和正式网)
- **数据库**: LibSQL (SQLite)
- **Web 服务器**: Hono
- **开发语言**: TypeScript
- **运行时**: Node.js 20+

## 项目结构

```
├── public/                     # 静态资源
│   ├── index.html             # Web 监控界面
│   ├── monitor-script.js      # 前端监控脚本
│   └── monitor-styles.css     # 界面样式
├── src/                        # 源代码
│   ├── agent/                  # AI Agent 相关
│   │   └── trading-agent.ts    # 核心交易 Agent
│   ├── tools/                  # 交易工具
│   │   ├── market-data.ts      # 市场数据获取
│   │   ├── position-manager.ts # 持仓管理
│   │   ├── trade-executor.ts   # 交易执行
│   │   └── account-info.ts     # 账户信息
│   ├── database/               # 数据库
│   │   └── index.ts            # 数据库初始化和操作
│   ├── exchange/               # 交易所接口
│   │   ├── gate.ts             # Gate.io API 客户端
│   │   └── okx.ts              # OKX API 客户端
│   ├── routes/                 # HTTP 路由
│   │   ├── monitor.ts          # 监控数据接口
│   │   └── positions.ts        # 持仓管理接口
│   ├── index.ts                # 服务器入口
│   └── config.ts               # 配置管理
├── docs/                       # 文档
│   └── TRADING_STRATEGIES_ZH.md # 交易策略说明
├── .env                        # 环境配置
├── .env.example                # 环境配置示例
├── package.json                # 项目配置
└── README.md                   # 项目说明
```

## 核心功能

### AI 驱动决策
- **模型支持**: DeepSeek V3.2, Grok4, Claude 4.5, Gemini Pro 2.5
- **自主分析**: 无预配置交易信号
- **多时间框架**: 跨多个时间窗口聚合数据
- **风险管理**: AI 控制的仓位规模和杠杆管理

### 交易功能
- **支持资产**: BTC, ETH, SOL, BNB, XRP, DOGE, GT, TRUMP, ADA, WLFI
- **合约类型**: USDT 结算永续合约
- **杠杆范围**: 1倍至25倍(可配置)
- **订单类型**: 市价单、止损、止盈

### 实时监控
- **Web 仪表板**: 实时账户指标和持仓概览
- **AI 决策日志**: 透明展示模型推理过程
- **交易历史**: 完整的交易记录与时间戳

## 关键配置参数

### 交易参数
- `TRADING_STRATEGY`: 交易策略 (balanced/conservative/aggressive等)
- `TRADING_INTERVAL_MINUTES`: 交易循环间隔
- `MAX_LEVERAGE`: 最大杠杆倍数
- `MAX_POSITIONS`: 最大持仓数量
- `MAX_HOLDING_HOURS`: 最大持有时长
- `EXTREME_STOP_LOSS_PERCENT`: 极端止损百分比
- `INITIAL_BALANCE`: 初始资金
- `ACCOUNT_STOP_LOSS_USDT`: 账户止损线
- `ACCOUNT_TAKE_PROFIT_USDT`: 账户止盈线

### 风控配置
- `ACCOUNT_DRAWDOWN_WARNING_PERCENT`: 回撤警告阈值 (20%)
- `ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT`: 禁止开仓阈值 (30%)
- `ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT`: 强制平仓阈值 (50%)

### API 配置
- `EXCHANGE`: 交易所选择 (gate/okx)
- `OPENAI_API_KEY`: AI 模型 API 密钥
- `OPENAI_BASE_URL`: OpenAI 兼容 API 基础 URL
- `AI_MODEL_NAME`: 模型名称 (如: deepseek/deepseek-v3.2-exp)

## 常用命令

```bash
# 安装依赖
npm install

# 数据库初始化
npm run db:init

# 开发模式(热重载)
npm run dev

# 生产模式启动交易
npm run trading:start

# 编译 TypeScript
npm run build

# 查看项目状态
npm run status
```

## 开发指南

### 添加新交易策略

1. 在 `docs/TRADING_STRATEGIES_ZH.md` 中添加策略说明
2. 在 `src/config.ts` 中添加策略配置
3. 更新环境变量说明文档
4. 测试新策略效果

### 添加新交易所

1. 在 `src/exchange/` 目录创建新的交易所适配器
2. 实现统一的接口方法 (下单、查询持仓、获取市场数据等)
3. 在 `src/config.ts` 中添加交易所选择逻辑
4. 更新文档和配置示例

### 修改前端界面

- **主要文件**: `public/index.html`, `public/monitor-script.js`, `public/monitor-styles.css`
- **API 接口**: `src/routes/monitor.ts`, `src/routes/positions.ts`
- 界面支持实时数据更新和主题切换

### 数据库操作

- 使用 LibSQL (SQLite) 进行本地数据持久化
- 数据库文件: `.voltagent/trading.db`
- 主要存储: 交易记录、账户历史、AI 决策日志

## 安全注意事项

1. **API 密钥安全**
   - 绝不在代码中硬编码 API 密钥
   - 使用 `.env` 文件存储敏感信息
   - 测试网优先，生产环境谨慎操作

2. **交易风险**
   - 系统仅供教育和研究目的
   - 加密货币交易具有高风险
   - 务必先在测试网验证策略

3. **手动平仓**
   - 网页界面平仓需要密码验证
   - 密码通过 `CLOSE_POSITION_PASSWORD` 环境变量配置

## 故障排查

### 常见问题

1. **启动失败**
   - 检查 Node.js 版本 >= 20.19.0
   - 确认数据库已初始化 (`npm run db:init`)
   - 验证 `.env` 配置文件完整性

2. **API 连接失败**
   - 确认 API 密钥正确
   - 检查网络连接
   - 验证交易所账户余额

3. **交易失败**
   - 检查合约账户余额(需要从现货账户划转)
   - 确认杠杆倍数和持仓数量配置
   - 查看风控参数是否触发

### 日志查看

- 服务器日志: 控制台输出
- 交易日志: 数据库存储
- AI 决策: Web 界面实时展示

## 扩展开发

### 添加新的市场指标

1. 在 `src/tools/market-data.ts` 中添加数据获取方法
2. 在 AI 提示中包含新指标信息
3. 更新前端显示逻辑

### 集成新的 AI 模型

1. 更新 `OPENAI_BASE_URL` 配置
2. 修改 `AI_MODEL_NAME` 为目标模型
3. 调整提示词以适配模型特性
4. 测试模型响应效果

### 自定义风控规则

1. 在 `src/agent/trading-agent.ts` 中添加风控逻辑
2. 更新配置参数
3. 添加对应的监控指标

## 贡献指南

1. Fork 项目仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 参考资源

- [VoltAgent 文档](https://voltagent.dev/docs/)
- [OpenRouter 模型目录](https://openrouter.ai/models)
- [Gate.io API 参考](https://www.gate.io/docs/developers/apiv4/)
- [OKX API 参考](https://www.okx.com/docs-v5/zh/)
- [项目完整文档](./README_ZH.md)

## 许可证

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 协议。详见 [LICENSE](./LICENSE) 文件。

---

**重要提醒**: 本系统仅供教育和研究目的，加密货币交易具有重大风险，用户对所有交易活动承担全部责任。