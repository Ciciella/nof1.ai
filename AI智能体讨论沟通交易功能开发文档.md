# AI智能体讨论沟通交易功能开发文档

## 目录

1. [概述](#概述)
2. [多智能体架构](#多智能体架构)
3. [通信机制](#通信机制)
4. [实现方式](#实现方式)
5. [代码示例](#代码示例)
6. [最佳实践](#最佳实践)
7. [常见问题](#常见问题)

---

## 概述

AI智能体讨论沟通交易功能是本系统的核心特性之一，通过多个专业化AI智能体协作，实现更准确、更可靠的交易决策。系统支持多种多智能体策略，包括陪审团策略和激进团策略。

### 核心优势

- **专业化分工**：每个智能体专注于特定领域（技术分析、趋势分析、资金流向、风险控制等）
- **集体决策**：通过多个智能体的意见综合，降低单一决策的风险
- **并行处理**：多个智能体可以并行分析不同维度，提高决策效率
- **风险分散**：不同智能体的观点相互制衡，避免极端决策

### 支持的策略

| 策略名称 | 智能体数量 | 架构模式 | 适用场景 |
|---------|-----------|---------|---------|
| 陪审团策略 (multi-agent-consensus) | 4个 | 法官+陪审团 | 追求稳健决策、重视风险控制 |
| 激进团策略 (aggressive-team) | 5个 | 团长+团员 | 追求极致收益、能承受高风险 |

---

## 多智能体架构

### 架构设计原则

1. **角色明确**：每个智能体有明确的职责和专长
2. **通信高效**：通过统一的通信机制实现智能体间协作
3. **决策透明**：每个智能体的分析过程和结论可追溯
4. **灵活扩展**：易于添加新的智能体或调整智能体配置

### 陪审团策略架构

```
┌─────────────────────────────────────────────────────────┐
│                     法官 (主Agent)                        │
│  - 统筹全局分析                                           │
│  - 独立给出初始决策                                       │
│  - 综合陪审团意见做出最终决策                             │
└──────────────┬──────────────────────────────────────────┘
               │
               │ delegate_task
               │
       ┌───────┴────────┬──────────────┬──────────────┐
       ▼                ▼              ▼              ▼
┌──────────┐    ┌──────────┐   ┌──────────┐   ┌──────────┐
│ 技术分析  │    │ 趋势分析  │   │ 风险评估  │   │ 资金流向  │
│  Agent   │    │  Agent   │   │  Agent   │   │  Agent   │
└──────────┘    └──────────┘   └──────────┘   └──────────┘
```

**智能体角色说明**：

| 智能体 | 职责 | 专长领域 |
|-------|------|---------|
| 法官 (主Agent) | 统筹全局，综合决策 | 市场整体分析、决策综合 |
| 技术分析Agent | 技术指标分析 | EMA、MACD、RSI等技术指标 |
| 趋势分析Agent | 趋势判断 | K线形态、支撑位、压力位 |
| 风险评估Agent | 风险评估 | 持仓风险、市场风险、杠杆风险 |
| 资金流向Agent | 资金分析 | 成交量、资金费率、订单簿 |

### 激进团策略架构

```
┌─────────────────────────────────────────────────────────┐
│                   团长 (主Agent)                         │
│  - 统筹全局分析                                           │
│  - 独立给出初始决策                                       │
│  - 综合团员意见做出最终决策                               │
│  - 负责多币种并行分析协调                                 │
└──────────────┬──────────────────────────────────────────┘
               │
               │ delegate_task (并行调用)
               │
       ┌───────┴────────┬──────────────┬──────────────┬──────────────┐
       ▼                ▼              ▼              ▼              ▼
┌──────────┐    ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ 趋势分析  │    │ 预测分析  │   │ 资金流向  │   │ 风险控制  │   │ (可选)   │
│  专家    │    │  专家    │   │  专家    │   │  专家    │   │  其他    │
└──────────┘    └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

**智能体角色说明**：

| 智能体 | 职责 | 专长领域 |
|-------|------|---------|
| 团长 (主Agent) | 统筹全局，综合决策 | 市场整体分析、决策综合、多币种协调 |
| 趋势分析专家 | K线图深度分析 | 价格走势、支撑位、压力位、上下通道 |
| 预测分析专家 | 技术指标预测 | 多时间框架验证、指标共振 |
| 资金流向专家 | 资金流向分析 | 成交量、资金费率、订单簿 |
| 风险控制专家 | 风险评估 | 持仓风险、市场风险、杠杆建议 |

---

## 通信机制

### delegate_task 机制

`delegate_task` 是智能体间通信的核心机制，允许主智能体将特定任务委托给其他专业化智能体执行。

#### 工作原理

1. **任务委托**：主智能体通过 `delegate_task` 工具将任务委托给子智能体
2. **并行执行**：多个子智能体可以并行执行各自的任务
3. **结果收集**：主智能体收集所有子智能体的分析结果
4. **综合决策**：主智能体综合所有结果做出最终决策

#### 通信流程

```
主智能体
  │
  ├─> delegate_task("分析技术指标") ──> 技术分析Agent
  │                                    │
  ├─> delegate_task("分析趋势") ─────> 趋势分析Agent
  │                                    │
  ├─> delegate_task("评估风险") ─────> 风险评估Agent
  │                                    │
  └─> delegate_task("分析资金流向") ─> 资金流向Agent
                                       │
                                       ▼
                                  返回分析结果
                                       │
                                       ▼
                              主智能体综合决策
```

### 通信特点

1. **异步执行**：子智能体异步执行任务，不阻塞主智能体
2. **并行处理**：多个子智能体可以同时工作，提高效率
3. **结果聚合**：主智能体自动收集和聚合所有子智能体的结果
4. **上下文共享**：智能体间可以共享市场数据等上下文信息

---

## 实现方式

### 核心文件结构

```
src/
├── agents/
│   ├── tradingAgent.ts           # 主智能体实现
│   ├── analysisAgents.ts         # 陪审团专业化智能体
│   └── aggressiveTeamAgents.ts   # 激进团专业化智能体
├── strategies/
│   ├── multiAgentConsensus.ts    # 陪审团策略配置
│   └── aggressiveTeam.ts         # 激进团策略配置
└── tools/
    └── trading/
        └── index.ts              # 交易工具（包括delegate_task）
```

### 智能体创建

#### 创建专业化智能体

所有专业化智能体都遵循相同的创建模式：

```typescript
import { Agent } from "@voltagent/core";
import { createOpenAI } from "@ai-sdk/openai";
import { tradingTools } from "../tools/trading";
import { logger } from "../utils/logger";

export function createTechnicalAnalystAgent(marketDataContext?: any) {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  let instructions = `你是技术分析专家，专注于加密货币技术指标分析。

你的任务：
- 分析技术指标（EMA、MACD、RSI、成交量等）
- 给出技术评分（1-10分）和建议方向（做多/做空/观望）
- 结合持仓情况给出操作建议`;

  if (marketDataContext) {
    instructions += `\n\n当前市场数据上下文：\n${JSON.stringify(marketDataContext, null, 2)}`;
  }

  const agent = new Agent({
    name: "技术分析Agent",
    instructions,
    model: openai.chat(process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp"),
    tools: [
      tradingTools.getMarketPriceTool,
      tradingTools.getTechnicalIndicatorsTool,
      tradingTools.getFundingRateTool,
      tradingTools.getOrderBookTool,
      tradingTools.getAccountBalanceTool,
      tradingTools.getPositionsTool,
    ],
    logger: logger.child({ agent: "技术分析Agent" }),
  });

  return agent;
}
```

#### 创建主智能体

主智能体包含 `delegate_task` 工具，用于与子智能体通信：

```typescript
import { Agent } from "@voltagent/core";
import { createOpenAI } from "@ai-sdk/openai";
import { tradingTools } from "../tools/trading";
import { logger } from "../utils/logger";

function createDelegateTaskTool(marketData?: any) {
  return {
    type: "function",
    function: {
      name: "delegate_task",
      description: "将特定任务委托给专业化Agent执行",
      parameters: {
        type: "object",
        properties: {
          agent_name: {
            type: "string",
            description: "要调用的Agent名称",
            enum: ["技术分析Agent", "趋势分析Agent", "风险评估Agent", "资金流向Agent"],
          },
          task_description: {
            type: "string",
            description: "任务描述，简短清晰即可",
          },
        },
        required: ["agent_name", "task_description"],
      },
    },
    handler: async (args: any) => {
      const { agent_name, task_description } = args;
      
      switch (agent_name) {
        case "技术分析Agent":
          const techAgent = createTechnicalAnalystAgent(marketData);
          return await techAgent.run(task_description);
        case "趋势分析Agent":
          const trendAgent = createTrendAnalystAgent(marketData);
          return await trendAgent.run(task_description);
        case "风险评估Agent":
          const riskAgent = createRiskAssessmentAgent(marketData);
          return await riskAgent.run(task_description);
        case "资金流向Agent":
          const flowAgent = createMoneyFlowAgent(marketData);
          return await flowAgent.run(task_description);
        default:
          throw new Error(`未知的Agent: ${agent_name}`);
      }
    },
  };
}

export function createTradingAgent(intervalMinutes: number, marketData?: any) {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const agent = new Agent({
    name: "TradingAgent",
    model: openai.chat(process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp"),
    tools: {
      getMarketPrice: tradingTools.getMarketPriceTool,
      getTechnicalIndicators: tradingTools.getTechnicalIndicatorsTool,
      getFundingRate: tradingTools.getFundingRateTool,
      openPosition: tradingTools.openPositionTool,
      closePosition: tradingTools.closePositionTool,
      getAccountBalance: tradingTools.getAccountBalanceTool,
      getPositions: tradingTools.getPositionsTool,
      delegateTask: createDelegateTaskTool(marketData),
    },
    logger: logger.child({ agent: "TradingAgent" }),
  });

  return agent;
}
```

### 策略配置

#### 陪审团策略配置

```typescript
export function getMultiAgentConsensusStrategy(maxLeverage: number): StrategyParams {
  const levMin = Math.max(2, Math.ceil(maxLeverage * 0.55));
  const levMax = Math.max(3, Math.ceil(maxLeverage * 0.80));
  
  const levNormal = levMin;
  const levGood = Math.ceil((levMin + levMax) / 2);
  const levStrong = levMax;
  
  return {
    name: "陪审团策略",
    description: "法官与陪审团合议决策，主Agent独立分析+三个专业Agent辅助，追求高质量决策",
    
    leverageMin: levMin,
    leverageMax: levMax,
    leverageRecommend: {
      normal: `${levNormal}倍`,
      good: `${levGood}倍`,
      strong: `${levStrong}倍`,
    },
    
    positionSizeMin: 20,
    positionSizeMax: 30,
    
    stopLoss: {
      low: -6,
      mid: -5,
      high: -4,
    },
    
    trailingStop: {
      level1: { trigger: 8, stopAt: 3 },
      level2: { trigger: 15, stopAt: 8 },
      level3: { trigger: 25, stopAt: 15 },
    },
    
    partialTakeProfit: {
      stage1: { trigger: 25, closePercent: 30 },
      stage2: { trigger: 40, closePercent: 50 },
      stage3: { trigger: 60, closePercent: 100 },
    },
  };
}
```

#### 激进团策略配置

```typescript
export function getAggressiveTeamStrategy(maxLeverage: number): StrategyParams {
  const aggressiveLevMin = Math.max(3, Math.ceil(maxLeverage * 0.85));
  const aggressiveLevMax = maxLeverage;
  
  const aggressiveLevNormal = aggressiveLevMin;
  const aggressiveLevGood = Math.ceil((aggressiveLevMin + aggressiveLevMax) / 2);
  const aggressiveLevStrong = aggressiveLevMax;
  
  return {
    name: "激进团",
    description: "团长统筹+4团员专业分析，高杠杆高仓位，猛干不畏缩，单边行情至少1个持仓，方向不对立即反手，适合追求极致收益的激进投资者",
    
    leverageMin: aggressiveLevMin,
    leverageMax: aggressiveLevMax,
    leverageRecommend: {
      normal: `${aggressiveLevNormal}倍`,
      good: `${aggressiveLevGood}倍`,
      strong: `${aggressiveLevStrong}倍`,
    },
    
    positionSizeMin: 25,
    positionSizeMax: 32,
    
    stopLoss: {
      low: -12,
      mid: -8,
      high: -6,
    },
    
    trailingStop: {
      level1: { trigger: 15, stopAt: 8 },
      level2: { trigger: 30, stopAt: 20 },
      level3: { trigger: 50, stopAt: 35 },
    },
    
    partialTakeProfit: {
      stage1: { trigger: 30, closePercent: 30 },
      stage2: { trigger: 50, closePercent: 50 },
      stage3: { trigger: 80, closePercent: 100 },
    },
  };
}
```

---

## 代码示例

### 示例1：陪审团策略决策流程

```typescript
import { createTradingAgent } from "../agents/tradingAgent";
import { getMultiAgentConsensusStrategy } from "../strategies/multiAgentConsensus";

async function executeMultiAgentDecision() {
  const strategy = getMultiAgentConsensusStrategy(10);
  const agent = createTradingAgent(5, marketData);
  
  const prompt = `
请分析当前市场情况并做出交易决策。

策略信息：
- 策略名称：${strategy.name}
- 策略描述：${strategy.description}
- 杠杆范围：${strategy.leverageMin}-${strategy.leverageMax}倍
- 仓位范围：${strategy.positionSizeMin}-${strategy.positionSizeMax}%

决策流程：
1. 你作为法官，首先独立分析市场并给出初始决策
2. 使用delegate_task调用三个Agent，只传递简短的任务描述：
   - 技术分析Agent：分析技术指标
   - 趋势分析Agent：分析市场趋势
   - 风险评估Agent：评估持仓风险
3. 综合三个Agent的意见，结合你的初始分析，做出最终决策

在delegate_task中只需传递简短的任务描述即可，例如：
- "分析BTC当前的技术指标"
- "分析BTC当前的市场趋势"
- "评估当前持仓的风险"

请按照以下格式输出：
1. 你的初始分析
2. 三个Agent的分析结果
3. 综合决策（开仓/平仓/观望）
4. 如果开仓，说明方向、杠杆、仓位、止损、止盈
`;

  const result = await agent.run(prompt);
  console.log("决策结果:", result);
}
```

### 示例2：激进团策略决策流程

```typescript
import { createTradingAgent } from "../agents/tradingAgent";
import { getAggressiveTeamStrategy } from "../strategies/aggressiveTeam";

async function executeAggressiveTeamDecision() {
  const strategy = getAggressiveTeamStrategy(20);
  const agent = createTradingAgent(15, marketData);
  
  const context = {
    tradingSymbols: ["BTC", "ETH", "SOL"],
    currentPositions: [],
    marketData: marketData,
  };
  
  const prompt = `
请分析当前市场情况并做出交易决策。

策略信息：
- 策略名称：${strategy.name}
- 策略描述：${strategy.description}
- 杠杆范围：${strategy.leverageMin}-${strategy.leverageMax}倍
- 仓位范围：${strategy.positionSizeMin}-${strategy.positionSizeMax}%

可交易币种：${context.tradingSymbols.join(", ")}

决策流程：
1. 你作为团长，首先独立分析市场并给出初始决策
2. 【多币种并行分析】对每个可交易币种（${context.tradingSymbols.join(", ")}），使用delegate_task并行调用4个团员：
   - 趋势分析专家：分析K线走势
   - 预测分析专家：技术指标预测
   - 资金流向专家：分析资金流向
   - 风险控制专家：评估风险
3. 综合所有团员的分析结果，结合你的初始分析，做出最终决策

在delegate_task中只需传递简短清晰的任务描述即可，例如：
- "分析BTC的K线走势"
- "预测BTC的技术指标"
- "分析BTC的资金流向"
- "评估BTC的风险"

请按照以下格式输出：
1. 你的初始分析
2. 每个币种的4个团员分析结果
3. 综合决策（开仓/平仓/观望）
4. 如果开仓，说明币种、方向、杠杆、仓位、止损、止盈
`;

  const result = await agent.run(prompt);
  console.log("决策结果:", result);
}
```

### 示例3：创建自定义专业化智能体

```typescript
import { Agent } from "@voltagent/core";
import { createOpenAI } from "@ai-sdk/openai";
import { tradingTools } from "../tools/trading";
import { logger } from "../utils/logger";

export function createCustomAnalystAgent(marketDataContext?: any) {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  let instructions = `你是自定义分析专家。

你的任务：
- [根据你的需求填写具体任务]
- [根据你的需求填写具体任务]
- [根据你的需求填写具体任务]

输出格式：
- 评分（1-10分）
- 建议方向（做多/做空/观望）
- 详细分析
- 操作建议`;

  if (marketDataContext) {
    instructions += `\n\n当前市场数据上下文：\n${JSON.stringify(marketDataContext, null, 2)}`;
  }

  const agent = new Agent({
    name: "自定义分析Agent",
    instructions,
    model: openai.chat(process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp"),
    tools: [
      tradingTools.getMarketPriceTool,
      tradingTools.getTechnicalIndicatorsTool,
      tradingTools.getFundingRateTool,
      tradingTools.getOrderBookTool,
      tradingTools.getAccountBalanceTool,
      tradingTools.getPositionsTool,
    ],
    logger: logger.child({ agent: "自定义分析Agent" }),
  });

  return agent;
}
```

---

## 最佳实践

### 1. 智能体设计原则

- **职责单一**：每个智能体专注于一个特定领域
- **指令清晰**：为每个智能体提供清晰、详细的指令
- **工具适配**：为每个智能体配置合适的工具集
- **上下文共享**：通过marketDataContext共享市场数据

### 2. 通信优化

- **任务描述简短**：在delegate_task中传递简短清晰的任务描述
- **并行执行**：尽可能并行调用多个子智能体
- **结果聚合**：主智能体负责聚合和综合所有结果
- **错误处理**：妥善处理子智能体的错误和超时

### 3. 性能考虑

- **Token消耗**：多智能体策略的Token消耗约为单智能体的4-5倍
- **执行周期**：考虑延长执行周期以降低成本
- **并行处理**：利用并行处理提高效率
- **缓存机制**：对重复查询的数据使用缓存

### 4. 风险控制

- **决策透明**：记录每个智能体的分析过程和结论
- **结果验证**：主智能体验证子智能体的结果
- **异常检测**：检测和过滤异常的分析结果
- **人工干预**：保留人工干预的接口

### 5. 测试和调试

- **单元测试**：为每个智能体编写单元测试
- **集成测试**：测试智能体间的协作
- **日志记录**：详细记录智能体的执行过程
- **监控指标**：监控智能体的性能和准确性

---

## 常见问题

### Q1: 如何添加新的专业化智能体？

**A**: 按照以下步骤添加新的专业化智能体：

1. 在 `src/agents/` 目录下创建新的智能体文件
2. 实现智能体创建函数，遵循现有模式
3. 在主智能体的 `delegate_task` 工具中添加新的智能体调用
4. 更新策略配置中的智能体列表

示例：

```typescript
// src/agents/customAgent.ts
export function createCustomAgent(marketDataContext?: any) {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const agent = new Agent({
    name: "自定义Agent",
    instructions: "你是自定义分析专家...",
    model: openai.chat(process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp"),
    tools: [
      tradingTools.getMarketPriceTool,
      tradingTools.getTechnicalIndicatorsTool,
    ],
    logger: logger.child({ agent: "自定义Agent" }),
  });

  return agent;
}

// 在主智能体的delegate_task工具中添加
case "自定义Agent":
  const customAgent = createCustomAgent(marketData);
  return await customAgent.run(task_description);
```

### Q2: 如何优化多智能体策略的性能？

**A**: 可以通过以下方式优化性能：

1. **延长执行周期**：从5分钟延长到10分钟或15分钟
2. **减少智能体数量**：根据需要调整智能体数量
3. **使用缓存**：对市场数据等重复查询使用缓存
4. **并行处理**：确保子智能体并行执行
5. **优化提示词**：简化提示词，减少Token消耗

### Q3: 多智能体策略的成本是多少？

**A**: 多智能体策略的成本约为单智能体策略的4-5倍：

- **单智能体策略**：每次决策调用1次AI模型
- **陪审团策略**：每次决策调用4次AI模型（1个法官 + 3个陪审团成员）
- **激进团策略**：每次决策调用5次AI模型（1个团长 + 4个团员）

以5分钟执行周期为例：
- 单智能体：288次/天
- 陪审团：1152次/天
- 激进团：1440次/天

### Q4: 如何监控智能体的决策过程？

**A**: 可以通过以下方式监控：

1. **日志记录**：每个智能体的执行过程都会记录到日志
2. **数据库存储**：决策结果存储在数据库中
3. **API接口**：通过API接口查询历史决策
4. **Web界面**：通过Web界面实时查看决策过程

### Q5: 如何处理智能体间的意见冲突？

**A**: 主智能体负责处理意见冲突：

1. **权重分配**：为不同智能体分配不同的权重
2. **多数投票**：采用多数投票机制
3. **综合评估**：综合考虑所有智能体的意见
4. **人工干预**：在严重冲突时请求人工干预

### Q6: 如何测试多智能体策略？

**A**: 可以通过以下方式测试：

1. **单元测试**：为每个智能体编写单元测试
2. **集成测试**：测试智能体间的协作
3. **回测**：使用历史数据进行回测
4. **模拟交易**：在模拟环境中测试
5. **小额实盘**：小额资金进行实盘测试

---

## 附录

### A. 相关文件索引

| 文件路径 | 说明 |
|---------|------|
| `src/agents/tradingAgent.ts` | 主智能体实现 |
| `src/agents/analysisAgents.ts` | 陪审团专业化智能体 |
| `src/agents/aggressiveTeamAgents.ts` | 激进团专业化智能体 |
| `src/strategies/multiAgentConsensus.ts` | 陪审团策略配置 |
| `src/strategies/aggressiveTeam.ts` | 激进团策略配置 |
| `src/tools/trading/index.ts` | 交易工具（包括delegate_task） |
| `src/scheduler/tradingLoop.ts` | 交易循环实现 |

### B. 环境变量配置

```bash
# AI模型配置
AI_MODEL_NAME=deepseek/deepseek-v3.2-exp
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://openrouter.ai/api/v1

# 交易策略配置
TRADING_STRATEGY=multi-agent-consensus
TRADING_INTERVAL_MINUTES=5

# 风控参数
MAX_LEVERAGE=10
MAX_POSITIONS=3
INITIAL_BALANCE=2000
```

### C. 常用命令

```bash
# 启动交易系统
npm run trading:start

# 停止交易系统
npm run trading:stop

# 重启交易系统
npm run trading:restart

# 查看日志
pm2 logs open-nof1.ai

# 查看状态
pm2 status open-nof1.ai
```

---

**文档版本**: 1.0.0  
**最后更新**: 2025-12-29  
**维护者**: nof1.ai 团队
