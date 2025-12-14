/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 交易 Agent 配置（极简版）
 */
import { Agent, Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createLogger } from "../utils/loggerUtils";
import { createOpenAI } from "@ai-sdk/openai";
import * as tradingTools from "../tools/trading";
import { formatChinaTime, getChinaTimeISO } from "../utils/timeUtils";
import { RISK_PARAMS } from "../config/riskParams";
import { createClient } from '@libsql/client';

/**
 * 账户风险配置
 */
export interface AccountRiskConfig {
  stopLossUsdt: number;
  takeProfitUsdt: number;
  syncOnStartup: boolean;
}

/**
 * 从环境变量读取账户风险配置
 */
export function getAccountRiskConfig(): AccountRiskConfig {
  return {
    stopLossUsdt: Number.parseFloat(process.env.ACCOUNT_STOP_LOSS_USDT || "50"),
    takeProfitUsdt: Number.parseFloat(process.env.ACCOUNT_TAKE_PROFIT_USDT || "10000"),
    syncOnStartup: process.env.SYNC_CONFIG_ON_STARTUP === "true",
  };
}

/**
 * 导入策略类型和参数
 */
import type { TradingStrategy, StrategyParams, StrategyPromptContext } from "../strategies";
import { getStrategyParams as getStrategyParamsBase, generateStrategySpecificPrompt, generateAlphaBetaPrompt } from "../strategies";

// 重新导出类型供外部使用
export type { TradingStrategy, StrategyParams };

/**
 * 获取策略参数（包装函数，自动传入 MAX_LEVERAGE）
 */
export function getStrategyParams(strategy: TradingStrategy): StrategyParams {
  return getStrategyParamsBase(strategy, RISK_PARAMS.MAX_LEVERAGE);
}

const logger = createLogger({
  name: "trading-agent",
  level: "debug",
});

/**
 * 数据库客户端
 */
const dbClient = createClient({
  url: process.env.DATABASE_URL || 'file:.voltagent/trading.db',
});

/**
 * 记录智能体发言到数据库
 */
export async function recordAgentMessage(
  decisionId: number,
  agentName: string,
  agentRole: string,
  messageType: string,
  content: string,
  round: number
): Promise<void> {
  try {
    await dbClient.execute({
      sql: `INSERT INTO agent_conversations
            (decision_id, agent_name, agent_role, message_type, message_content, round_number, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        decisionId,
        agentName,
        agentRole,
        messageType,
        content,
        round,
        getChinaTimeISO(),
      ],
    });
    logger.debug(`记录智能体发言成功: ${agentName} (${agentRole}) - 轮次${round}`);
  } catch (error) {
    logger.error('记录智能体发言失败:', error);
    throw error;
  }
}

/**
 * Token预算管理器
 */
class TokenBudgetManager {
  private totalBudget: number;
  private usedTokens: number = 0;
  private roundCosts: Map<number, number> = new Map();

  constructor(totalBudget: number = 5000) {
    this.totalBudget = totalBudget;
  }

  addRoundCost(round: number, cost: number): void {
    this.roundCosts.set(round, cost);
    this.usedTokens += cost;
  }

  shouldContinueDiscussion(round: number, estimatedCost: number): boolean {
    const projectedTotal = this.usedTokens + estimatedCost;
    const remainingBudget = this.totalBudget - this.usedTokens;
    return remainingBudget > 1000 && round < 3 && projectedTotal < this.totalBudget;
  }

  getTotalCost(): number {
    return this.usedTokens;
  }

  getRemainingBudget(): number {
    return this.totalBudget - this.usedTokens;
  }
}

/**
 * 从环境变量读取交易策略
 */
export function getTradingStrategy(): TradingStrategy {
  const strategy = process.env.TRADING_STRATEGY || "balanced";
  if (strategy === "conservative" || strategy === "balanced" || strategy === "aggressive" || strategy === "aggressive-team" || strategy === "ultra-short" || strategy === "swing-trend" || strategy === "medium-long" || strategy === "rebate-farming" || strategy === "ai-autonomous" || strategy === "multi-agent-consensus" || strategy === "alpha-beta") {
    return strategy;
  }
  logger.warn(`未知的交易策略: ${strategy}，使用默认策略: balanced`);
  return "balanced";
}

/**
 * 生成Alpha Beta策略的交易提示词
 * 结合策略规则（来自alphaBeta.ts）和周期数据
 */
function generateAlphaBetaPromptForCycle(data: {
  minutesElapsed: number;
  iteration: number;
  intervalMinutes: number;
  marketData: any;
  accountInfo: any;
  positions: any[];
  tradeHistory?: any[];
  recentDecisions?: any[];
}): string {
  const { minutesElapsed, iteration, intervalMinutes, marketData, accountInfo, positions, tradeHistory, recentDecisions } = data;
  const currentTime = formatChinaTime();
  const params = getStrategyParams('alpha-beta');
  
  // 生成策略规则提示词
  const strategyPrompt = generateAlphaBetaPrompt(params, {
    intervalMinutes,
    maxPositions: RISK_PARAMS.MAX_POSITIONS,
    extremeStopLossPercent: RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT,
    maxHoldingHours: RISK_PARAMS.MAX_HOLDING_HOURS,
    tradingSymbols: RISK_PARAMS.TRADING_SYMBOLS,
  });
  
  // 生成周期数据提示词
  let dataPrompt = `
---
【交易周期 #${iteration}】${currentTime}
---

已运行: ${minutesElapsed} 分钟
执行周期: 每 ${intervalMinutes} 分钟

---
【当前账户状态】
---

总资产: ${(accountInfo?.totalBalance ?? 0).toFixed(2)} USDT
可用余额: ${(accountInfo?.availableBalance ?? 0).toFixed(2)} USDT
未实现盈亏: ${(accountInfo?.unrealisedPnl ?? 0) >= 0 ? '+' : ''}${(accountInfo?.unrealisedPnl ?? 0).toFixed(2)} USDT
持仓数量: ${positions?.length ?? 0} 个

`;

  // 输出持仓信息
  if (positions && positions.length > 0) {
    dataPrompt += `---
【当前持仓】
---

`;
    for (const pos of positions) {
      const holdingMinutes = Math.floor((new Date().getTime() - new Date(pos.opened_at).getTime()) / (1000 * 60));
      const holdingHours = (holdingMinutes / 60).toFixed(1);
      
      const entryPrice = pos.entry_price ?? 0;
      const currentPrice = pos.current_price ?? 0;
      const unrealizedPnl = pos.unrealized_pnl ?? 0;
      let pnlPercent = 0;
      
      if (entryPrice > 0 && currentPrice > 0) {
        if (pos.side === 'long') {
          pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100 * (pos.leverage ?? 1);
        } else {
          pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100 * (pos.leverage ?? 1);
        }
      }
      
      dataPrompt += `${pos.contract} ${pos.side === 'long' ? '做多' : '做空'}:
  持仓量: ${pos.quantity ?? 0} 张
  杠杆: ${pos.leverage ?? 1}x
  入场价: ${entryPrice.toFixed(2)}
  当前价: ${currentPrice.toFixed(2)}
  盈亏: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)} USDT)
  持仓时间: ${holdingHours} 小时

`;
    }
  } else {
    dataPrompt += `---
【当前持仓】
---

无持仓

`;
    
    // 计算空仓时间
    if (params.maxIdleHours) {
      let lastCloseTime: Date | null = null;
      
      if (tradeHistory && tradeHistory.length > 0) {
        for (const trade of tradeHistory) {
          if (trade.type === 'close') {
            lastCloseTime = new Date(trade.timestamp);
            break;
          }
        }
      }
      
      if (!lastCloseTime) {
        lastCloseTime = new Date(Date.now() - minutesElapsed * 60 * 1000);
      }
      
      const idleMinutes = Math.floor((Date.now() - lastCloseTime.getTime()) / (1000 * 60));
      const idleHours = idleMinutes / 60;
      const maxIdleHours = params.maxIdleHours;
      
      if (idleHours >= maxIdleHours * 0.75) {
        const remainingMinutes = Math.max(0, maxIdleHours * 60 - idleMinutes);
        const isUrgent = idleHours >= maxIdleHours;
        
        dataPrompt += `---
【空仓时间警告】
---

`;
        
        if (isUrgent) {
          dataPrompt += `** 紧急！已超过最大空仓时间 **
当前空仓时间：${Math.floor(idleHours)}小时${Math.floor(idleMinutes % 60)}分钟
已超过最大空仓时间限制（${maxIdleHours}小时）
必须在本周期内开仓！

开仓门槛调整：
- 信号评分要求：>=65分（正常>=70分）
- 仓位大小：8-10%
- 杠杆倍数：2倍
- 止损设置：-3%

`;
        } else {
          dataPrompt += `空仓时间提醒：
当前空仓时间：${Math.floor(idleHours)}小时${Math.floor(idleMinutes % 60)}分钟
距离${maxIdleHours}小时限制还有：${Math.floor(remainingMinutes)}分钟
建议尽快寻找开仓机会

`;
        }
      }
    }
  }

  // 输出市场数据
  dataPrompt += `---
【市场数据】
---

`;

  if (marketData) {
    for (const [symbol, dataRaw] of Object.entries(marketData)) {
      const data = dataRaw as any;
      
      dataPrompt += `【${symbol}】
当前价格: ${(data?.price ?? 0).toFixed(2)}
EMA20: ${(data?.ema20 ?? 0).toFixed(2)}
EMA50: ${(data?.ema50 ?? 0).toFixed(2)}
MACD: ${(data?.macd ?? 0).toFixed(4)}
RSI(7): ${(data?.rsi7 ?? 0).toFixed(1)}
`;
      
      if (data?.fundingRate !== undefined) {
        dataPrompt += `资金费率: ${(data.fundingRate * 100).toFixed(4)}%
`;
      }
      
      dataPrompt += `
`;
      
      // 输出1H时间框架数据（最重要）
      if (data?.multiTimeframe?.['1h']) {
        const tf = data.multiTimeframe['1h'] as any;
        dataPrompt += `1H时间框架（主要参考）:
  价格序列: ${(tf?.prices ?? []).slice(-5).map((p: number) => p.toFixed(1)).join(' -> ')}
  EMA20序列: ${(tf?.ema20 ?? []).slice(-5).map((e: number) => e.toFixed(1)).join(' -> ')}
  MACD序列: ${(tf?.macd ?? []).slice(-5).map((m: number) => m.toFixed(3)).join(' -> ')}
  趋势判断: ${tf?.ema20?.length > 0 && tf?.ema20[tf.ema20.length-1] > tf?.ema50?.[tf.ema50.length-1] ? '多头排列' : '空头排列'}

`;
      }
    }
  }

  // 输出历史交易记录
  if (tradeHistory && tradeHistory.length > 0) {
    dataPrompt += `---
【最近交易记录】
---

`;
    let profitCount = 0;
    let lossCount = 0;
    let longCount = 0;
    let shortCount = 0;
    let totalProfit = 0;
    
    for (const trade of tradeHistory.slice(0, 10)) {
      const tradeTime = formatChinaTime(trade.timestamp);
      const pnl = trade?.pnl ?? 0;
      
      dataPrompt += `${trade.symbol}_USDT ${trade.side === 'long' ? '做多' : '做空'}:
  时间: ${tradeTime}
  盈亏: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT

`;
      
      if (trade.side === 'long') longCount++;
      else shortCount++;
      
      if (pnl > 0) profitCount++;
      else if (pnl < 0) lossCount++;
      totalProfit += pnl;
    }
    
    if (profitCount > 0 || lossCount > 0) {
      const winRate = profitCount / (profitCount + lossCount) * 100;
      const longRate = longCount / (longCount + shortCount) * 100;
      dataPrompt += `统计（最近${Math.min(10, tradeHistory.length)}笔）:
- 胜率: ${winRate.toFixed(1)}% (${profitCount}胜${lossCount}负)
- 做多比例: ${longRate.toFixed(0)}% (${longCount}多/${shortCount}空)
- 净盈亏: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT
${longRate > 80 ? '\n** 警告：做空比例过低，请认真检查做空机会！**\n' : ''}
`;
    }
  }

  // 输出历史决策记录
  if (recentDecisions && recentDecisions.length > 0) {
    dataPrompt += `---
【最近决策记录】
---

`;
    for (let i = 0; i < Math.min(3, recentDecisions.length); i++) {
      const decision = recentDecisions[i];
      const decisionTime = formatChinaTime(decision.timestamp);
      dataPrompt += `周期 #${decision.iteration} (${decisionTime}):
  账户: ${(decision?.account_value ?? 0).toFixed(2)} USDT
  持仓: ${decision?.positions_count ?? 0}个
  决策: ${decision?.decision ?? '无'}

`;
    }
  }

  dataPrompt += `---
【可用工具】
---

- openPosition: 开仓（symbol, side, leverage, amountUsdt）
- closePosition: 平仓（symbol, closePercent）

现在请按照策略规则进行分析和决策。
`;

  return strategyPrompt + dataPrompt;
}

/**
 * 生成AI自主策略的交易提示词（极简版，只提供数据和工具）
 */
function generateAiAutonomousPromptForCycle(data: {
  minutesElapsed: number;
  iteration: number;
  intervalMinutes: number;
  marketData: any;
  accountInfo: any;
  positions: any[];
  tradeHistory?: any[];
  recentDecisions?: any[];
}): string {
  const { minutesElapsed, iteration, intervalMinutes, marketData, accountInfo, positions, tradeHistory, recentDecisions } = data;
  const currentTime = formatChinaTime();
  
  let prompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【交易周期 #${iteration}】${currentTime}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

已运行: ${minutesElapsed} 分钟
执行周期: 每 ${intervalMinutes} 分钟

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【系统硬性风控底线】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 单笔亏损 ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%：系统强制平仓
• 持仓时间 ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS} 小时：系统强制平仓
• 最大杠杆：${RISK_PARAMS.MAX_LEVERAGE} 倍
• 最大持仓数：${RISK_PARAMS.MAX_POSITIONS} 个
• 可交易币种：${RISK_PARAMS.TRADING_SYMBOLS.join(", ")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【当前账户状态】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

总资产: ${(accountInfo?.totalBalance ?? 0).toFixed(2)} USDT
可用余额: ${(accountInfo?.availableBalance ?? 0).toFixed(2)} USDT
未实现盈亏: ${(accountInfo?.unrealisedPnl ?? 0) >= 0 ? '+' : ''}${(accountInfo?.unrealisedPnl ?? 0).toFixed(2)} USDT
持仓数量: ${positions?.length ?? 0} 个

`;

  // 输出持仓信息
  if (positions && positions.length > 0) {
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【当前持仓】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    for (const pos of positions) {
      const holdingMinutes = Math.floor((new Date().getTime() - new Date(pos.opened_at).getTime()) / (1000 * 60));
      const holdingHours = (holdingMinutes / 60).toFixed(1);
      
      // 计算盈亏百分比
      const entryPrice = pos.entry_price ?? 0;
      const currentPrice = pos.current_price ?? 0;
      const unrealizedPnl = pos.unrealized_pnl ?? 0;
      let pnlPercent = 0;
      
      if (entryPrice > 0 && currentPrice > 0) {
        if (pos.side === 'long') {
          pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100 * (pos.leverage ?? 1);
        } else {
          pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100 * (pos.leverage ?? 1);
        }
      }
      
      prompt += `${pos.contract} ${pos.side === 'long' ? '做多' : '做空'}:\n`;
      
      prompt += `  持仓量: ${pos.quantity ?? 0} 张\n`;
      prompt += `  杠杆: ${pos.leverage ?? 1}x\n`;
      prompt += `  入场价: ${entryPrice.toFixed(2)}\n`;
      prompt += `  当前价: ${currentPrice.toFixed(2)}\n`;
      prompt += `  盈亏: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)} USDT)\n`;
      prompt += `  持仓时间: ${holdingHours} 小时\n\n`;
    }
  } else {
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【当前持仓】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

无持仓

`;
    
    // 计算空仓时间（仅对 alpha-beta 策略）
    const strategy = getTradingStrategy();
    const params = getStrategyParams(strategy);
    
    if (strategy === 'alpha-beta' && params.maxIdleHours) {
      // 查找最后一笔平仓交易的时间
      let lastCloseTime: Date | null = null;
      
      if (tradeHistory && tradeHistory.length > 0) {
        // 找到最近的平仓记录
        for (const trade of tradeHistory) {
          if (trade.type === 'close') {
            lastCloseTime = new Date(trade.timestamp);
            break; // tradeHistory 已经按时间倒序排列
          }
        }
      }
      
      // 如果没有找到平仓记录，说明从未开仓，使用系统启动时间
      // 这里我们使用当前时间减去已运行分钟数作为启动时间
      if (!lastCloseTime) {
        lastCloseTime = new Date(Date.now() - minutesElapsed * 60 * 1000);
      }
      
      // 计算空仓时长
      const idleMinutes = Math.floor((Date.now() - lastCloseTime.getTime()) / (1000 * 60));
      const idleHours = idleMinutes / 60;
      const maxIdleHours = params.maxIdleHours;
      
      // 如果空仓时间超过4.5小时（75%的限制），开始提醒
      if (idleHours >= maxIdleHours * 0.75) {
        const remainingMinutes = Math.max(0, maxIdleHours * 60 - idleMinutes);
        const isUrgent = idleHours >= maxIdleHours;
        
        prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【空仓时间警告】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
        
        if (isUrgent) {
          prompt += `⚠️⚠️⚠️ 紧急提醒 ⚠️⚠️⚠️
当前空仓时间：${Math.floor(idleHours)}小时${Math.floor(idleMinutes % 60)}分钟
已超过最大空仓时间限制（${maxIdleHours}小时）
**必须在本周期内开仓！**

`;
        } else {
          prompt += `⚠️ 空仓时间提醒
当前空仓时间：${Math.floor(idleHours)}小时${Math.floor(idleMinutes % 60)}分钟
距离${maxIdleHours}小时限制还有：${Math.floor(remainingMinutes)}分钟
建议尽快寻找开仓机会

`;
        }
        
        prompt += `开仓门槛调整：
- 信号评分要求：≥70分（正常≥75分）
- 震荡市评分要求：≥75分（正常≥80分）
- 仓位大小：8-10%（最小档位）
- 杠杆倍数：2倍（保守档位）
- 止损设置：-3%（严格执行）

重要说明：
- 此规则是为了防止过度保守，不是鼓励盲目交易
- 即使降低门槛，也必须有基本的技术支持
- 可以选择多个币种中信号最好的
- 开仓后仍需严格执行止损止盈规则

`;
      }
    }
  }

  // 输出市场数据
  prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【市场数据】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

注意：所有价格和指标数据按时间顺序排列（最旧 → 最新）

`;

  // 输出每个币种的市场数据
  if (marketData) {
    for (const [symbol, dataRaw] of Object.entries(marketData)) {
      const data = dataRaw as any;
      
      prompt += `\n【${symbol}】\n`;
      prompt += `当前价格: ${(data?.price ?? 0).toFixed(1)}\n`;
      prompt += `EMA20: ${(data?.ema20 ?? 0).toFixed(3)}\n`;
      prompt += `MACD: ${(data?.macd ?? 0).toFixed(3)}\n`;
      prompt += `RSI(7): ${(data?.rsi7 ?? 0).toFixed(3)}\n`;
      
      if (data?.fundingRate !== undefined) {
        prompt += `资金费率: ${data.fundingRate.toExponential(2)}\n`;
      }
      
      prompt += `\n`;
      
      // 输出多时间框架数据
      if (data?.multiTimeframe) {
        for (const [timeframe, tfData] of Object.entries(data.multiTimeframe)) {
          const tf = tfData as any;
          prompt += `${timeframe} 时间框架:\n`;
          prompt += `  价格序列: ${(tf?.prices ?? []).map((p: number) => p.toFixed(1)).join(', ')}\n`;
          prompt += `  EMA20序列: ${(tf?.ema20 ?? []).map((e: number) => e.toFixed(2)).join(', ')}\n`;
          prompt += `  MACD序列: ${(tf?.macd ?? []).map((m: number) => m.toFixed(3)).join(', ')}\n`;
          prompt += `  RSI序列: ${(tf?.rsi ?? []).map((r: number) => r.toFixed(1)).join(', ')}\n`;
          prompt += `  成交量序列: ${(tf?.volumes ?? []).map((v: number) => v.toFixed(0)).join(', ')}\n\n`;
        }
      }
    }
  }

  // 输出历史交易记录（如果有）
  if (tradeHistory && tradeHistory.length > 0) {
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【最近交易记录】（最近10笔）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    let profitCount = 0;
    let lossCount = 0;
    let totalProfit = 0;
    
    for (const trade of tradeHistory.slice(0, 10)) {
      const tradeTime = formatChinaTime(trade.timestamp);
      const pnl = trade?.pnl ?? 0;
      
      // 计算收益率（如果有pnl和价格信息）
      let pnlPercent = 0;
      if (pnl !== 0 && trade.price && trade.quantity && trade.leverage) {
        const positionValue = trade.price * trade.quantity / trade.leverage;
        if (positionValue > 0) {
          pnlPercent = (pnl / positionValue) * 100;
        }
      }
      
      prompt += `${trade.symbol}_USDT ${trade.side === 'long' ? '做多' : '做空'}:\n`;
      prompt += `  时间: ${tradeTime}\n`;
      prompt += `  盈亏: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT\n`;
      if (pnlPercent !== 0) {
        prompt += `  收益率: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%\n`;
      }
      prompt += `\n`;
      
      if (pnl > 0) {
        profitCount++;
      } else if (pnl < 0) {
        lossCount++;
      }
      totalProfit += pnl;
    }
    
    // 添加统计信息
    if (profitCount > 0 || lossCount > 0) {
      const winRate = profitCount / (profitCount + lossCount) * 100;
      prompt += `最近10笔交易统计:\n`;
      prompt += `  胜率: ${winRate.toFixed(1)}%\n`;
      prompt += `  盈利交易: ${profitCount}笔\n`;
      prompt += `  亏损交易: ${lossCount}笔\n`;
      prompt += `  净盈亏: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT\n\n`;
    }
  }

  // 输出历史决策记录（如果有）
  if (recentDecisions && recentDecisions.length > 0) {
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【历史决策记录】（最近5次）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    for (let i = 0; i < Math.min(5, recentDecisions.length); i++) {
      const decision = recentDecisions[i];
      const decisionTime = formatChinaTime(decision.timestamp);
      const timeDiff = Math.floor((new Date().getTime() - new Date(decision.timestamp).getTime()) / (1000 * 60));
      
      prompt += `周期 #${decision.iteration} (${decisionTime}，${timeDiff}分钟前):\n`;
      prompt += `  账户价值: ${(decision?.account_value ?? 0).toFixed(2)} USDT\n`;
      prompt += `  持仓数量: ${decision?.positions_count ?? 0}\n`;
      prompt += `  决策内容: ${decision?.decision ?? '无'}\n\n`;
    }
    
    prompt += `注意：以上是历史决策记录，仅供参考。请基于当前最新数据独立判断。\n\n`;
  }
  
  // 添加自我复盘要求
  prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【自我复盘要求】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

在做出交易决策之前，请先进行自我复盘：

1. **回顾最近交易表现**：
   - 分析最近的盈利交易：什么做对了？（入场时机、杠杆选择、止盈策略等）
   - 分析最近的亏损交易：什么做错了？（入场过早/过晚、杠杆过高、止损不及时等）
   - 当前胜率如何？是否需要调整策略？

2. **评估当前策略有效性**：
   - 当前使用的交易策略是否适应市场环境？
   - 杠杆和仓位管理是否合理？
   - 是否存在重复犯错的模式？

3. **识别改进空间**：
   - 哪些方面可以做得更好？
   - 是否需要调整风险管理方式？
   - 是否需要改变交易频率或持仓时间？

4. **制定改进计划**：
   - 基于复盘结果，本次交易应该如何调整策略？
   - 需要避免哪些之前犯过的错误？
   - 如何提高交易质量？

**复盘输出格式**：
在做出交易决策前，请先输出你的复盘思考（用文字描述），然后再执行交易操作。

例如：
\`\`\`
【复盘思考】
- 最近3笔交易中，2笔盈利1笔亏损，胜率66.7%
- 盈利交易的共同点：都是在多时间框架共振时入场，使用了适中的杠杆（10-15倍）
- 亏损交易的问题：入场过早，没有等待足够的确认信号，且使用了过高的杠杆（20倍）
- 改进计划：本次交易将更加耐心等待信号确认，杠杆控制在15倍以内
- 当前市场环境：BTC处于震荡区间，应该降低交易频率，只在明确信号时入场

【本次交易决策】
（然后再执行具体的交易操作）
\`\`\`

`;

  prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【可用工具】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• openPosition: 开仓（做多或做空）
  - 参数: symbol（币种）, side（long/short）, leverage（杠杆）, amountUsdt（金额）
  - 手续费: 约 0.05%

• closePosition: 平仓
  - 参数: symbol（币种）, closePercent（平仓百分比，默认100%）
  - 手续费: 约 0.05%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【开始交易】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

请基于以上市场数据和账户信息，完全自主地分析市场并做出交易决策。
你可以选择：
1. 开新仓位（做多或做空）
2. 平掉现有仓位
3. 继续持有
4. 观望不交易

记住：
- 没有任何策略建议和限制（除了系统硬性风控底线）
- 完全由你自主决定交易策略
- 完全由你自主决定风险管理
- 完全由你自主决定何时交易

现在请做出你的决策并执行。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  return prompt;
}

/**
 * 生成交易提示词（参照 1.md 格式）
 */
export function generateTradingPrompt(data: {
  minutesElapsed: number;
  iteration: number;
  intervalMinutes: number;
  marketData: any;
  accountInfo: any;
  positions: any[];
  tradeHistory?: any[];
  recentDecisions?: any[];
  positionCount?: number;
}): string {
  const { minutesElapsed, iteration, intervalMinutes, marketData, accountInfo, positions, tradeHistory, recentDecisions, positionCount } = data;
  const currentTime = formatChinaTime();
  
  // 获取当前策略参数（用于每周期强调风控规则）
  const strategy = getTradingStrategy();
  const params = getStrategyParams(strategy);
  // 判断是否启用自动监控止损和移动止盈（根据策略配置）
  const isCodeLevelProtectionEnabled = params.enableCodeLevelProtection;
  // 判断是否允许AI在代码级保护之外继续主动操作（双重防护模式）
  const allowAiOverride = params.allowAiOverrideProtection === true;
  
  // 如果是AI自主策略，使用极简的提示词格式
  if (strategy === "ai-autonomous") {
    return generateAiAutonomousPromptForCycle(data);
  }
  
  // 如果是Alpha Beta策略，结合策略规则和周期数据
  if (strategy === "alpha-beta") {
    return generateAlphaBetaPromptForCycle(data);
  }
  
  // 生成止损规则描述（基于 stopLoss 配置和杠杆范围）
  const generateStopLossDescriptions = () => {
    const levMin = params.leverageMin;
    const levMax = params.leverageMax;
    const lowThreshold = Math.ceil(levMin + (levMax - levMin) * 0.33);
    const midThreshold = Math.ceil(levMin + (levMax - levMin) * 0.67);
    return [
      `${levMin}-${lowThreshold}倍杠杆，亏损 ${params.stopLoss.low}% 时止损`,
      `${lowThreshold + 1}-${midThreshold}倍杠杆，亏损 ${params.stopLoss.mid}% 时止损`,
      `${midThreshold + 1}倍以上杠杆，亏损 ${params.stopLoss.high}% 时止损`,
    ];
  };
  const stopLossDescriptions = generateStopLossDescriptions();
  
  // 生成紧急警告（仅激进团策略）
  let urgentWarnings = '';
  if (strategy === 'aggressive-team') {
    // 检查持仓数是否不足2个
    const currentPositionCount = positionCount ?? positions.length;
    if (currentPositionCount < 2) {
      urgentWarnings += `
⚠️⚠️⚠️ 【紧急警告】当前持仓数不足2个！激进团铁律被违反！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前持仓：${currentPositionCount}个
铁律要求：≥ 2个
状态：❌ 违规
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

本次交易周期必须至少开1个新仓，确保持仓数达到2个！
这是激进团的核心要求，不容违反！

`;
    }
  }
  
  let prompt = urgentWarnings + `【交易周期 #${iteration}】${currentTime}
已运行 ${minutesElapsed} 分钟，执行周期 ${intervalMinutes} 分钟

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前策略：${params.name}（${params.description}）
目标月回报：${params.name === '稳健' ? '10-20%' : params.name === '平衡' ? '20-40%' : params.name === '激进' ? '30-50%（频繁小盈利累积）' : params.name === '激进团' ? '50-80%' : '20-30%'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【硬性风控底线 - 系统强制执行】
┌─────────────────────────────────────────┐
│ 单笔亏损 ≤ ${RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT}%：强制平仓               │
│ 持仓时间 ≥ ${RISK_PARAMS.MAX_HOLDING_HOURS}小时：强制平仓             │
└─────────────────────────────────────────┘

【AI战术决策 - 强烈建议遵守】
┌─────────────────────────────────────────┐
│ 策略止损：${params.stopLoss.low}% ~ ${params.stopLoss.high}%（根据杠杆）│
│ 分批止盈：                               │
│   • 盈利≥+${params.partialTakeProfit.stage1.trigger}% → 平仓${params.partialTakeProfit.stage1.closePercent}%  │
│   • 盈利≥+${params.partialTakeProfit.stage2.trigger}% → 平仓${params.partialTakeProfit.stage2.closePercent}%  │
│   • 盈利≥+${params.partialTakeProfit.stage3.trigger}% → 平仓${params.partialTakeProfit.stage3.closePercent}% │
│ 峰值回撤：≥${params.peakDrawdownProtection}% → 危险信号，立即平仓 │
${isCodeLevelProtectionEnabled ? (allowAiOverride ? `│                                         │
│ 双重防护模式：                          │
│   • 代码自动监控（每10秒）作为安全网   │
│   • Level1: 峰值${params.trailingStop.level1.trigger}%→止损线${params.trailingStop.level1.stopAt}% │
│   • Level2: 峰值${params.trailingStop.level2.trigger}%→止损线${params.trailingStop.level2.stopAt}% │
│   • Level3: 峰值${params.trailingStop.level3.trigger}%→止损线${params.trailingStop.level3.stopAt}% │
│   • 你可以主动止损止盈，不必等待自动   │
│   • 主动管理风险是优秀交易员的标志     │` : `│                                         │
│ 注意：移动止盈由自动监控执行（每10秒） │
│   • Level1: 峰值${params.trailingStop.level1.trigger}%→止损线${params.trailingStop.level1.stopAt}% │
│   • Level2: 峰值${params.trailingStop.level2.trigger}%→止损线${params.trailingStop.level2.stopAt}% │
│   • Level3: 峰值${params.trailingStop.level3.trigger}%→止损线${params.trailingStop.level3.stopAt}% │
│   • 无需AI手动执行移动止盈              │`) : `│                                         │
│ 注意：当前策略未启用自动监控移动止盈      │
│   • AI需主动监控峰值回撤并执行止盈      │
│   • 盈利${params.trailingStop.level1.trigger}%→止损线${params.trailingStop.level1.stopAt}%   │
│   • 盈利${params.trailingStop.level2.trigger}%→止损线${params.trailingStop.level2.stopAt}%   │
│   • 盈利${params.trailingStop.level3.trigger}%→止损线${params.trailingStop.level3.stopAt}%   │`}
└─────────────────────────────────────────┘

【决策流程 - 按优先级执行】
(1) 持仓管理（最优先）：
   检查每个持仓的止损/止盈/峰值回撤 → closePosition
   
(2) 新开仓评估：
   分析市场数据 → 识别双向机会（做多/做空） → openPosition
   
(3) 加仓评估：
   盈利>5%且趋势强化 → openPosition（≤50%原仓位，相同或更低杠杆）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【数据说明】
本提示词已预加载所有必需数据：
• 所有币种的市场数据和技术指标（多时间框架）
• 账户信息（余额、收益率、夏普比率）
• 当前持仓状态（盈亏、持仓时间、杠杆）
• 历史交易记录（最近10笔）

【您的任务】
直接基于上述数据做出交易决策，无需重复获取数据：
1. 分析持仓管理需求（止损/止盈/加仓）→ 调用 closePosition / openPosition 执行
2. 识别新交易机会（做多/做空）→ 调用 openPosition 执行
3. 评估风险和仓位管理 → 调用 calculateRisk 验证

关键：您必须实际调用工具执行决策，不要只停留在分析阶段！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

以下所有价格或信号数据按时间顺序排列：最旧 → 最新

时间框架说明：除非在章节标题中另有说明，否则日内序列以 3 分钟间隔提供。如果某个币种使用不同的间隔，将在该币种的章节中明确说明。

所有币种的当前市场状态
`;

  // 按照 1.md 格式输出每个币种的数据
  for (const [symbol, dataRaw] of Object.entries(marketData)) {
    const data = dataRaw as any;
    
    prompt += `\n所有 ${symbol} 数据\n`;
    prompt += `当前价格 = ${data.price.toFixed(1)}, 当前EMA20 = ${data.ema20.toFixed(3)}, 当前MACD = ${data.macd.toFixed(3)}, 当前RSI（7周期） = ${data.rsi7.toFixed(3)}\n\n`;
    
    // 资金费率
    if (data.fundingRate !== undefined) {
      prompt += `此外，这是 ${symbol} 永续合约的最新资金费率（您交易的合约类型）：\n\n`;
      prompt += `资金费率: ${data.fundingRate.toExponential(2)}\n\n`;
    }
    
    // 日内时序数据（3分钟级别）
    if (data.intradaySeries && data.intradaySeries.midPrices.length > 0) {
      const series = data.intradaySeries;
      prompt += `日内序列（按分钟，最旧 → 最新）：\n\n`;
      
      // Mid prices
      prompt += `中间价: [${series.midPrices.map((p: number) => p.toFixed(1)).join(", ")}]\n\n`;
      
      // EMA indicators (20‑period)
      prompt += `EMA指标（20周期）: [${series.ema20Series.map((e: number) => e.toFixed(3)).join(", ")}]\n\n`;
      
      // MACD indicators
      prompt += `MACD指标: [${series.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      
      // RSI indicators (7‑Period)
      prompt += `RSI指标（7周期）: [${series.rsi7Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      
      // RSI indicators (14‑Period)
      prompt += `RSI指标（14周期）: [${series.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
    }
    
    // 更长期的上下文数据（1小时级别 - 用于短线交易）
    if (data.longerTermContext) {
      const ltc = data.longerTermContext;
      prompt += `更长期上下文（1小时时间框架）：\n\n`;
      
      prompt += `20周期EMA: ${ltc.ema20.toFixed(2)} vs. 50周期EMA: ${ltc.ema50.toFixed(2)}\n\n`;
      
      if (ltc.atr3 && ltc.atr14) {
        prompt += `3周期ATR: ${ltc.atr3.toFixed(2)} vs. 14周期ATR: ${ltc.atr14.toFixed(3)}\n\n`;
      }
      
      prompt += `当前成交量: ${ltc.currentVolume.toFixed(2)} vs. 平均成交量: ${ltc.avgVolume.toFixed(3)}\n\n`;
      
      // MACD 和 RSI 时序（4小时，最近10个数据点）
      if (ltc.macdSeries && ltc.macdSeries.length > 0) {
        prompt += `MACD指标: [${ltc.macdSeries.map((m: number) => m.toFixed(3)).join(", ")}]\n\n`;
      }
      
      if (ltc.rsi14Series && ltc.rsi14Series.length > 0) {
        prompt += `RSI指标（14周期）: [${ltc.rsi14Series.map((r: number) => r.toFixed(3)).join(", ")}]\n\n`;
      }
    }
    
    // 多时间框架指标数据
    if (data.timeframes) {
      prompt += `多时间框架指标：\n\n`;
      
      const tfList = [
        { key: "1m", name: "1分钟" },
        { key: "3m", name: "3分钟" },
        { key: "5m", name: "5分钟" },
        { key: "15m", name: "15分钟" },
        { key: "30m", name: "30分钟" },
        { key: "1h", name: "1小时" },
      ];
      
      for (const tf of tfList) {
        const tfData = data.timeframes[tf.key];
        if (tfData) {
          prompt += `${tf.name}: 价格=${tfData.currentPrice.toFixed(2)}, EMA20=${tfData.ema20.toFixed(3)}, EMA50=${tfData.ema50.toFixed(3)}, MACD=${tfData.macd.toFixed(3)}, RSI7=${tfData.rsi7.toFixed(2)}, RSI14=${tfData.rsi14.toFixed(2)}, 成交量=${tfData.volume.toFixed(2)}\n`;
        }
      }
      prompt += `\n`;
    }
  }

  // 账户信息和表现（参照 1.md 格式）
  prompt += `\n以下是您的账户信息和表现\n`;
  
  // 计算账户回撤（如果提供了初始净值和峰值净值）
  if (accountInfo.initialBalance !== undefined && accountInfo.peakBalance !== undefined) {
    const drawdownFromPeak = ((accountInfo.peakBalance - accountInfo.totalBalance) / accountInfo.peakBalance) * 100;
    const drawdownFromInitial = ((accountInfo.initialBalance - accountInfo.totalBalance) / accountInfo.initialBalance) * 100;
    
    prompt += `初始账户净值: ${accountInfo.initialBalance.toFixed(2)} USDT\n`;
    prompt += `峰值账户净值: ${accountInfo.peakBalance.toFixed(2)} USDT\n`;
    prompt += `当前账户价值: ${accountInfo.totalBalance.toFixed(2)} USDT\n`;
    prompt += `账户回撤 (从峰值): ${drawdownFromPeak >= 0 ? '' : '+'}${(-drawdownFromPeak).toFixed(2)}%\n`;
    prompt += `账户回撤 (从初始): ${drawdownFromInitial >= 0 ? '' : '+'}${(-drawdownFromInitial).toFixed(2)}%\n\n`;
    
    // 添加风控警告（使用配置参数）
    // 注释：已移除强制清仓限制，仅保留警告提醒
    if (drawdownFromPeak >= RISK_PARAMS.ACCOUNT_DRAWDOWN_WARNING_PERCENT) {
      prompt += `提醒: 账户回撤已达到 ${drawdownFromPeak.toFixed(2)}%，请谨慎交易\n\n`;
    }
  } else {
    prompt += `当前账户价值: ${accountInfo.totalBalance.toFixed(2)} USDT\n\n`;
  }
  
  prompt += `当前总收益率: ${accountInfo.returnPercent.toFixed(2)}%\n\n`;
  
  // 计算所有持仓的未实现盈亏总和
  const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);
  
  prompt += `可用资金: ${accountInfo.availableBalance.toFixed(1)} USDT\n\n`;
  prompt += `未实现盈亏: ${totalUnrealizedPnL.toFixed(2)} USDT (${totalUnrealizedPnL >= 0 ? '+' : ''}${((totalUnrealizedPnL / accountInfo.totalBalance) * 100).toFixed(2)}%)\n\n`;
  
  // 当前持仓和表现
  if (positions.length > 0) {
    prompt += `以下是您当前的持仓信息。重要说明：\n`;
    prompt += `- 所有"盈亏百分比"都是考虑杠杆后的值，公式为：盈亏百分比 = (价格变动%) × 杠杆倍数\n`;
    prompt += `- 例如：10倍杠杆，价格上涨0.5%，则盈亏百分比 = +5%（保证金增值5%）\n`;
    prompt += `- 这样设计是为了让您直观理解实际收益：+10% 就是本金增值10%，-10% 就是本金亏损10%\n`;
    prompt += `- 请直接使用系统提供的盈亏百分比，不要自己重新计算\n\n`;
    for (const pos of positions) {
      // 计算盈亏百分比：考虑杠杆倍数
      // 对于杠杆交易：盈亏百分比 = (价格变动百分比) × 杠杆倍数
      const priceChangePercent = pos.entry_price > 0 
        ? ((pos.current_price - pos.entry_price) / pos.entry_price * 100 * (pos.side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * pos.leverage;
      
      // 计算持仓时长
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingMinutes = Math.floor((now.getTime() - openedTime.getTime()) / (1000 * 60));
      const holdingHours = (holdingMinutes / 60).toFixed(1);
      const remainingHours = Math.max(0, RISK_PARAMS.MAX_HOLDING_HOURS - parseFloat(holdingHours));
      const holdingCycles = Math.floor(holdingMinutes / intervalMinutes); // 根据实际执行周期计算
      const maxCycles = Math.floor(RISK_PARAMS.MAX_HOLDING_HOURS * 60 / intervalMinutes); // 最大持仓时间的总周期数
      const remainingCycles = Math.max(0, maxCycles - holdingCycles);
      
      // 计算峰值回撤（使用绝对回撤，即百分点）
      const peakPnlPercent = pos.peak_pnl_percent || 0;
      const drawdownFromPeak = peakPnlPercent > 0 ? peakPnlPercent - pnlPercent : 0;
      
      prompt += `当前活跃持仓: ${pos.symbol} ${pos.side === 'long' ? '做多' : '做空'}\n`;
      prompt += `  杠杆倍数: ${pos.leverage}x\n`;
      prompt += `  盈亏百分比: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (已考虑杠杆倍数)\n`;
      prompt += `  盈亏金额: ${pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)} USDT\n`;
      
      // 添加峰值盈利和回撤信息
      if (peakPnlPercent > 0) {
        prompt += `  峰值盈利: +${peakPnlPercent.toFixed(2)}% (历史最高点)\n`;
        prompt += `  峰值回撤: ${drawdownFromPeak.toFixed(2)}%\n`;
        if (drawdownFromPeak >= params.peakDrawdownProtection) {
          prompt += `  警告: 峰值回撤已达到 ${drawdownFromPeak.toFixed(2)}%，超过保护阈值 ${params.peakDrawdownProtection}%，强烈建议立即平仓！\n`;
        } else if (drawdownFromPeak >= params.peakDrawdownProtection * 0.7) {
          prompt += `  提醒: 峰值回撤接近保护阈值 (当前${drawdownFromPeak.toFixed(2)}%，阈值${params.peakDrawdownProtection}%)，需要密切关注！\n`;
        }
      }
      
      prompt += `  开仓价: ${pos.entry_price.toFixed(2)}\n`;
      prompt += `  当前价: ${pos.current_price.toFixed(2)}\n`;
      prompt += `  开仓时间: ${formatChinaTime(pos.opened_at)}\n`;
      prompt += `  已持仓: ${holdingHours} 小时 (${holdingMinutes} 分钟, ${holdingCycles} 个周期)\n`;
      prompt += `  距离${RISK_PARAMS.MAX_HOLDING_HOURS}小时限制: ${remainingHours.toFixed(1)} 小时 (${remainingCycles} 个周期)\n`;
      
      // 如果接近最大持仓时间,添加警告
      if (remainingHours < 2) {
        prompt += `  警告: 即将达到${RISK_PARAMS.MAX_HOLDING_HOURS}小时持仓限制,必须立即平仓!\n`;
      } else if (remainingHours < 4) {
        prompt += `  提醒: 距离${RISK_PARAMS.MAX_HOLDING_HOURS}小时限制不足4小时,请准备平仓\n`;
      }
      
      prompt += "\n";
    }
  }
  
  // Sharpe Ratio
  if (accountInfo.sharpeRatio !== undefined) {
    prompt += `夏普比率: ${accountInfo.sharpeRatio.toFixed(3)}\n\n`;
  }
  
  // 历史成交记录（最近10条）
  if (tradeHistory && tradeHistory.length > 0) {
    prompt += `\n最近交易历史（最近10笔交易，最旧 → 最新）：\n`;
    prompt += `重要说明：以下仅为最近10条交易的统计，用于分析近期策略表现，不代表账户总盈亏。\n`;
    prompt += `使用此信息评估近期交易质量、识别策略问题、优化决策方向。\n\n`;
    
    let totalProfit = 0;
    let profitCount = 0;
    let lossCount = 0;
    
    for (const trade of tradeHistory) {
      const tradeTime = formatChinaTime(trade.timestamp);
      
      prompt += `交易: ${trade.symbol} ${trade.type === 'open' ? '开仓' : '平仓'} ${trade.side.toUpperCase()}\n`;
      prompt += `  时间: ${tradeTime}\n`;
      prompt += `  价格: ${trade.price.toFixed(2)}, 数量: ${trade.quantity.toFixed(4)}, 杠杆: ${trade.leverage}x\n`;
      prompt += `  手续费: ${trade.fee.toFixed(4)} USDT\n`;
      
      // 对于平仓交易，总是显示盈亏金额
      if (trade.type === 'close') {
        if (trade.pnl !== undefined && trade.pnl !== null) {
          prompt += `  盈亏: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT\n`;
          totalProfit += trade.pnl;
          if (trade.pnl > 0) {
            profitCount++;
          } else if (trade.pnl < 0) {
            lossCount++;
          }
        } else {
          prompt += `  盈亏: 暂无数据\n`;
        }
      }
      
      prompt += `\n`;
    }
    
    if (profitCount > 0 || lossCount > 0) {
      const winRate = profitCount / (profitCount + lossCount) * 100;
      prompt += `最近10条交易统计（仅供参考）:\n`;
      prompt += `  - 胜率: ${winRate.toFixed(1)}%\n`;
      prompt += `  - 盈利交易: ${profitCount}笔\n`;
      prompt += `  - 亏损交易: ${lossCount}笔\n`;
      prompt += `  - 最近10条净盈亏: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT\n`;
      prompt += `\n注意：此数值仅为最近10笔交易统计，用于评估近期策略有效性，不是账户总盈亏。\n`;
      prompt += `账户真实盈亏请参考上方"当前账户状态"中的收益率和总资产变化。\n\n`;
    }
  }

  // 上一次的AI决策记录（仅供参考，不是当前状态）
  if (recentDecisions && recentDecisions.length > 0) {
    prompt += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    prompt += `【历史决策记录开始】\n`;
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    prompt += `重要提醒：以下是历史决策记录，仅作为参考，不代表当前状态！\n`;
    prompt += `当前市场数据和持仓信息请参考上方实时数据。\n\n`;
    
    for (let i = 0; i < recentDecisions.length; i++) {
      const decision = recentDecisions[i];
      const decisionTime = formatChinaTime(decision.timestamp);
      const timeDiff = Math.floor((new Date().getTime() - new Date(decision.timestamp).getTime()) / (1000 * 60));
      
      prompt += `【历史】决策 #${decision.iteration} (${decisionTime}，${timeDiff}分钟前):\n`;
      prompt += `  当时账户价值: ${decision.account_value.toFixed(2)} USDT\n`;
      prompt += `  当时持仓数量: ${decision.positions_count}\n`;
      prompt += `  当时决策内容: ${decision.decision}\n\n`;
    }
    prompt += `【历史决策记录结束】\n`;
    prompt += `\n使用建议：\n`;
    prompt += `- 仅作为决策连续性参考，不要被历史决策束缚\n`;
    prompt += `- 市场已经变化，请基于当前最新数据独立判断\n`;
    prompt += `- 如果市场条件改变，应该果断调整策略\n\n`;
  }

  return prompt;
}

/**
 * 生成群聊模式指令
 */
function generateChatModeInstructions(strategy: TradingStrategy, params: StrategyParams, intervalMinutes: number): string {
  const promptContext: StrategyPromptContext = {
    intervalMinutes,
    maxPositions: RISK_PARAMS.MAX_POSITIONS,
    extremeStopLossPercent: RISK_PARAMS.EXTREME_STOP_LOSS_PERCENT,
    maxHoldingHours: RISK_PARAMS.MAX_HOLDING_HOURS,
    tradingSymbols: RISK_PARAMS.TRADING_SYMBOLS,
  };

  let basePrompt = '';
  let agentRole = '';

  if (strategy === "multi-agent-consensus") {
    basePrompt = `你是一个法官智能体，负责主持多智能体陪审团讨论。
你有3个陪审员智能体：
- 技术分析专家：负责分析技术指标和价格形态
- 趋势分析专家：负责判断市场趋势和方向
- 风险评估专家：负责评估交易风险和控制仓位

讨论流程：
1. 轮次1：每个陪审员依次独立分析（技术分析 → 趋势分析 → 风险评估）
2. 轮次2：针对分歧点进行讨论和辩论
3. 轮次3：尝试达成共识
4. 最终：你作为法官汇总所有意见并做出最终决策

请使用 delegate_task 调用陪审员，并按以下格式输出：

【轮次1-技术分析员】
[你的分析内容]

【轮次1-趋势分析师】
[你的分析内容]

【轮次1-风险评估师】
[你的分析内容]

【轮次2-讨论】
[针对分歧的辩论]

【最终决策】
[你的汇总和决策]

**重要**：你的所有发言都将被记录到数据库中，请确保内容详细、逻辑清晰。`;
    agentRole = '法官';
  } else if (strategy === "aggressive-team") {
    basePrompt = `你是一个团长智能体，负责领导激进团智能体团队讨论。
你有4个团员智能体：
- 趋势分析专家：负责分析市场趋势和方向
- 预测分析专家：负责价格预测和目标位计算
- 资金流向专家：负责分析资金流向和市场情绪
- 风险控制专家：负责风险评估和仓位管理

讨论流程：
1. 轮次1：每个团员依次分析（趋势 → 预测 → 资金流向 → 风险控制）
2. 轮次2：针对分歧进行辩论
3. 轮次3：达成最终共识
4. 最终：你作为团长汇总并做出决策

请使用 delegate_task 调用团员，并按以下格式输出：

【轮次1-趋势专家】
[你的分析]

【轮次1-预测专家】
[你的分析]

【轮次1-资金流向专家】
[你的分析]

【轮次1-风险控制专家】
[你的分析]

【轮次2-辩论】
[讨论和辩论]

【最终决策】
[你的决策]

**重要**：你的所有发言都将被记录，请确保内容专业、准确。`;
    agentRole = '团长';
  } else if (strategy === "alpha-beta") {
    basePrompt = `你是一个Alpha Beta自主学习智能体，但你需要先进行自我对话和复盘。
你有两个内在声音：
- 理性分析声音：冷静分析数据和指标
- 直觉判断声音：基于经验和市场感觉

讨论流程：
1. 轮次1：理性分析声音先发言，分析市场数据
2. 轮次2：直觉判断声音发言，提供直觉判断
3. 轮次3：理性声音回应直觉声音，验证或质疑
4. 最终：综合两者意见做出最终决策

请按以下格式输出：

【轮次1-理性分析】
[基于数据的分析]

【轮次2-直觉判断】
[基于经验的判断]

【轮次3-理性回应】
[对直觉的验证]

【最终决策】
[综合决策]

**重要**：所有对话都会被记录，用于持续学习改进。`;
    agentRole = '自主学习者';
  } else {
    // 其他策略使用通用多智能体协作模式
    basePrompt = `你是一个${params.name}策略的AI交易员，需要进行多智能体协作讨论。
你有3个智能体助手：
- 技术分析师：负责分析技术指标和价格形态
- 风险控制师：负责评估交易风险和控制仓位
- 策略优化师：负责优化交易策略和时机

讨论流程：
1. 轮次1：每个智能体依次独立分析（技术分析 → 风险控制 → 策略优化）
2. 轮次2：针对分歧点进行讨论和辩论
3. 轮次3：尝试达成共识
4. 最终：你作为主决策者汇总所有意见并做出最终决策

请使用 delegate_task 调用智能体助手，并按以下格式输出：

【轮次1-技术分析师】
[你的分析内容]

【轮次1-风险控制师】
[你的分析内容]

【轮次1-策略优化师】
[你的分析内容]

【轮次2-讨论】
[针对分歧的辩论]

【最终决策】
[你的汇总和决策]

**重要**：你的所有发言都将被记录到数据库中，请确保内容详细、逻辑清晰。`;
    agentRole = '主决策者';
  }

  return basePrompt;
}

/**
 * 根据策略生成交易指令
 */
function generateInstructions(strategy: TradingStrategy, intervalMinutes: number): string {
  const params = getStrategyParams(strategy);

  // 所有策略都使用群聊模式（多智能体协作）
  return generateChatModeInstructions(strategy, params, intervalMinutes);
}

/**
 * 生成Alpha Beta策略的交易提示词
 * 结合策略规则（来自alphaBeta.ts）和周期数据
 */

/**
 * 创建交易 Agent
 * @param intervalMinutes 交易间隔（分钟）
 * @param marketDataContext 市场数据上下文（可选，用于子Agent）
 */
export async function createTradingAgent(intervalMinutes: number = 5, marketDataContext?: any) {
  // 使用 OpenAI SDK，通过配置 baseURL 兼容 OpenRouter 或其他供应商
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const memory = new Memory({
    storage: new LibSQLMemoryAdapter({
      url: "file:./.voltagent/trading-memory.db",
      logger: logger.child({ component: "libsql" }),
    }),
  });

  // 获取当前策略
  const strategy = getTradingStrategy();
  logger.info(`使用交易策略: ${strategy}`);

  // 如果是多Agent共识策略，创建子Agent
  let subAgents: Agent[] | undefined;
  if (strategy === "multi-agent-consensus") {
    logger.info("创建陪审团策略的子Agent（陪审团成员）...");
    const { createTechnicalAnalystAgent, createTrendAnalystAgent, createRiskAssessorAgent } = await import("./analysisAgents");

    // 传递市场数据上下文给子Agent
    subAgents = [
      createTechnicalAnalystAgent(marketDataContext),
      createTrendAnalystAgent(marketDataContext),
      createRiskAssessorAgent(marketDataContext),
    ];
    logger.info("陪审团成员创建完成：技术分析Agent、趋势分析Agent、风险评估Agent");
  }

  // 如果是激进团策略，创建子Agent
  if (strategy === "aggressive-team") {
    logger.info("创建激进团策略的子Agent（团员）...");
    const {
      createAggressiveTeamTrendExpertAgent,
      createAggressiveTeamPredictionExpertAgent,
      createAggressiveTeamMoneyFlowExpertAgent,
      createAggressiveTeamRiskControlExpertAgent
    } = await import("./aggressiveTeamAgents");

    // 传递市场数据上下文给子Agent
    subAgents = [
      createAggressiveTeamTrendExpertAgent(marketDataContext),
      createAggressiveTeamPredictionExpertAgent(marketDataContext),
      createAggressiveTeamMoneyFlowExpertAgent(marketDataContext),
      createAggressiveTeamRiskControlExpertAgent(marketDataContext),
    ];
    logger.info("激进团团员创建完成：趋势分析专家、预测分析专家、资金流向分析专家、风险控制专家");
  }

  const agent = new Agent({
    name: "trading-agent",
    instructions: generateInstructions(strategy, intervalMinutes),
    model: openai.chat(process.env.AI_MODEL_NAME || "deepseek/deepseek-v3.2-exp"),
    tools: [
      tradingTools.getMarketPriceTool,
      tradingTools.getTechnicalIndicatorsTool,
      tradingTools.getFundingRateTool,
      tradingTools.getOrderBookTool,
      tradingTools.openPositionTool,
      tradingTools.closePositionTool,
      tradingTools.cancelOrderTool,
      tradingTools.getAccountBalanceTool,
      tradingTools.getPositionsTool,
      tradingTools.getOpenOrdersTool,
      tradingTools.checkOrderStatusTool,
      tradingTools.calculateRiskTool,
      tradingTools.syncPositionsTool,
    ],
    subAgents,
    memory,
    logger
  });

  return agent;
}
