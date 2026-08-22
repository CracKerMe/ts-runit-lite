# 订单处理示例

这个示例展示条件分支、多节点流转和节点输出引用。

## 运行

在仓库根目录执行：

```bash
pnpm install
pnpm example:order
```

示例会注册 `order-processing-example` 工作流，以 500 元订单为输入，
等待执行完成后输出实例 ID、状态和各节点结果。

要修改测试输入，编辑 `examples/order-processing.ts` 中传给
`engine.start()` 的 context。

## 工作流结构

```text
validate-order
      |
      v
 check-amount
   /       \
  v         v
premium   standard
   \       /
    v     v
send-notification
      |
      v
complete-order
```

当 `orderAmount > 100` 时进入 `premium-process`，否则进入
`standard-process`。两个分支最后都会执行通知和订单完成节点。

## REST API

订单示例本身是仓库内的 TypeScript 示例，不会注册额外的
`/console/example/*` 路由。通用 REST API 可以通过以下命令启动：

```bash
pnpm dev:api
```

API 文档位于 `http://localhost:3345/api-docs`。
