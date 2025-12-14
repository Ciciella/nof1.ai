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

import { createClient } from '@libsql/client';
import { createLogger } from '../utils/loggerUtils';

const dbClient = createClient({
  url: process.env.DATABASE_URL || 'file:.voltagent/trading.db',
});

const logger = createLogger({
  name: 'migration',
  level: 'info',
});

/**
 * 数据库迁移：添加群聊对话支持
 */
export async function migrateAddConversations() {
  try {
    logger.info('🚀 开始数据库迁移：添加群聊对话支持...');

    // 检查 agent_conversations 表是否存在
    const tableExists = await dbClient.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_conversations'",
    });

    if (tableExists.rows.length === 0) {
      logger.info('📝 创建 agent_conversations 表...');

      await dbClient.execute(`
        CREATE TABLE IF NOT EXISTS agent_conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          decision_id INTEGER NOT NULL,
          agent_name TEXT NOT NULL,
          agent_role TEXT NOT NULL,
          message_type TEXT NOT NULL,
          message_content TEXT NOT NULL,
          round_number INTEGER NOT NULL DEFAULT 1,
          timestamp TEXT NOT NULL,
          FOREIGN KEY (decision_id) REFERENCES agent_decisions(id) ON DELETE CASCADE
        )
      `);

      logger.info('✅ agent_conversations 表创建成功');
    } else {
      logger.info('ℹ️ agent_conversations 表已存在，跳过创建');
    }

    // 检查并添加 agent_decisions 表的新列
    const columns = await dbClient.execute("PRAGMA table_info(agent_decisions)");
    const columnNames = columns.rows.map((col: any) => col.name);

    if (!columnNames.includes('agent_count')) {
      logger.info('📝 添加 agent_count 列到 agent_decisions 表...');
      await dbClient.execute("ALTER TABLE agent_decisions ADD COLUMN agent_count INTEGER DEFAULT 1");
      logger.info('✅ agent_count 列添加成功');
    }

    if (!columnNames.includes('discussion_rounds')) {
      logger.info('📝 添加 discussion_rounds 列到 agent_decisions 表...');
      await dbClient.execute("ALTER TABLE agent_decisions ADD COLUMN discussion_rounds INTEGER DEFAULT 1");
      logger.info('✅ discussion_rounds 列添加成功');
    }

    if (!columnNames.includes('consensus_reached')) {
      logger.info('📝 添加 consensus_reached 列到 agent_decisions 表...');
      await dbClient.execute("ALTER TABLE agent_decisions ADD COLUMN consensus_reached BOOLEAN DEFAULT FALSE");
      logger.info('✅ consensus_reached 列添加成功');
    }

    // 创建索引
    logger.info('📝 创建索引...');
    await dbClient.execute("CREATE INDEX IF NOT EXISTS idx_conversations_decision_id ON agent_conversations(decision_id)");
    await dbClient.execute("CREATE INDEX IF NOT EXISTS idx_conversations_round ON agent_conversations(decision_id, round_number)");
    await dbClient.execute("CREATE INDEX IF NOT EXISTS idx_conversations_decision_round ON agent_conversations(decision_id, round_number, id)");
    logger.info('✅ 索引创建成功');

    logger.info('🎉 数据库迁移完成！群聊对话功能已启用');

    // 验证迁移结果
    const conversationTableCheck = await dbClient.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_conversations'");
    if (conversationTableCheck.rows.length > 0) {
      logger.info('✅ 验证通过：agent_conversations 表存在');
    } else {
      throw new Error('验证失败：agent_conversations 表不存在');
    }

  } catch (error) {
    logger.error('❌ 数据库迁移失败:', error);
    throw error;
  }
}

// 如果直接运行此脚本，则执行迁移
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateAddConversations()
    .then(() => {
      logger.info('迁移脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('迁移脚本执行失败:', error);
      process.exit(1);
    });
}
