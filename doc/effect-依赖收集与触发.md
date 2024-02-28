## effect-依赖收集与触发

当前副作用存在且允许收集时，执行副作用，读取属性，建立对象属性与副作用之间的联系

### 前提

[位运算](https://bill-lai.github.io/article/9c6d734aa72e04e0f8dd/)

```js
// 位运算 举例
let trackOpBit = 1 = 0001;
let add = trackOpBit << 1 = 0010, del = trackOpBit << 2 = 0100, edit = trackOpBit << 3 = 1000;

let userAuth = add | del = 0110; // 用户有add、del权限

const haveEditAuth = userAuth & edit = 0110 & 1000 = 0000; // 没有编辑权限
const haveDelAuth = userAuth & del = 0110 & 0100 = 0100 > 0; // 有删除权限

const delAddAuth = userAuth & ~add = 0110 & 1101 = 0100; // 删除添加权限，只剩删除权限

```

### 收集依赖的逻辑（开始收集、暂停收集，当前激活的副作用设置时机）

1. 默认允许收集
2. 在所有的生命周期钩子中禁止收集，因为他们可能被内部的 effect 调用
3. 获取 setupResult、执行 flushPreFlushCbs 前先暂停收集，再恢复
4. 执行数组方法 ['push', 'pop', 'shift', 'unshift', 'splice'] 时，先暂停收集，再恢复
5. 当执行 effect.run 时,激活 activeEffect，开始允许收集，当副作用函数 fn 执行结束，清空无用依赖后，activeEffect 指向副作用栈中的下一个，shouldTrack 恢复到上一次的状态
6. enableTracking 源码中没用到

### 什么时候允许递归

1. 在 beforeUpdate、beforeMount、pre-lifecycle 生命周期钩子中不允许递归、组件渲染副作用允许递归更新

### 收集依赖：

1. shouldTrack && activeEffect 为真时收集
2. [不同情况收集的处理](https://zhuanlan.zhihu.com/p/614468288)

### 触发更新：

1. 默认先执行有 computed 属性的副作用，再执行剩余的副作用
2. 当要执行的副作用不是当前激活的副作用（如果是会陷入死循环）或者副作用允许递归
   如果有 scheduler，直接执行 scheduler，没有，执行 run

### effect 源码

```js
const targetMap = new WeakMap<any, KeyToDepMap>()

const maxMarkerBits = 30; // 最大递归深度

// 根据当前effect的递归深度往前推进，保证trackOpBit的二进制位数中为1的位置和w、n二进制数标识当前effect状态的位置是保持一致的
let trackOpBit = 1; // 当前副作用追踪深度
let effectTrackDepth = 0; // 当前递归调用次数

let activeEffect = null; // 当前激活的副作用
let shouldTrack = true // 默认应该收集

// 首次触发副作用时，还未开始收集，deps为空，会跳过initDepMarkers
// 再次触发副作用后，如果deps存在，那说明deps里的一定收集过了，给每一个打标记为wasTracked
export const initDepMarkers = ({ deps }: ReactiveEffect) => {
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      // 设置已被收集 标记当前副作用下的依赖收集情况
      deps[i].w |= trackOpBit // set was tracked
    }
  }
}

// 清空无效依赖，恢复追踪深度
export const finalizeDepMarkers = () => {
  const { deps } = effect
  if(deps.length) {
    // ...
    // 如果之前收集过，本次未收集，就将effect从dep删掉
    // 否则说明这个dep需要保留

    // 恢复到effect执行之前
    dep.w &= ~trackOpBit
    dep.n &= ~trackOpBit
  }
}

// 创建订阅器
export const createDep = (effects?: ReactiveEffect[]): Dep => {
  const dep = new Set<ReactiveEffect>(effects) as Dep
  dep.w = 0 // 之前收集的
  dep.n = 0 // 本次收集的
  return dep
}

export const wasTracked = (dep: Dep): boolean => (dep.w & trackOpBit) > 0

export const newTracked = (dep: Dep): boolean => (dep.n & trackOpBit) > 0

```

### ReactiveEffect

```js
export class ReactiveEffect<T = any> {

  active = true// 用于标识副作用函数是否位于上下文中
  deps: Dep[] = []
  parent: ReactiveEffect | undefined = undefined // 上一级effect实例

  /**
   * Can be attached after creation
   * @internal computed?
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   * 是否允许递归：在beforeUpdate、beforeMount、pre-lifecycle生命周期钩子中不允许递归、组件渲染副作用允许递归更新
   */
  allowRecurse?: boolean
  /**
   * @internal 是否延迟清理
   */
  private deferStop?: boolean

  onStop?: () => void
  // dev only
  onTrack?: (event: DebuggerEvent) => void
  // dev only
  onTrigger?: (event: DebuggerEvent) => void

  constructor(
    public fn: () => T, // 副作用函数
    public scheduler: EffectScheduler | null = null, // 调度
    scope?: EffectScope // 副作用域
  ) {
    // effect作用域 栈
    recordEffectScope(this, scope)
  }

  // 1. effect.run()
  run() {
    // 如果不在当前上下文
    if (!this.active) {
      return this.fn()
    }
    // 可能是嵌套副作用，先暂存上一次的activeEffect、shouldTrack
    let parent: ReactiveEffect | undefined = activeEffect
    let lastShouldTrack = shouldTrack
    while (parent) {
      if (parent === this) {
        return
      }
      parent = parent.parent
    }
    try {
      this.parent = activeEffect
      activeEffect = this // 激活effect
      shouldTrack = true // 开始收集

      trackOpBit = 1 << ++effectTrackDepth // 设置当前追踪深度

    // 管理方案：
      // 本次如果没有收集过当前dep，就看之前有没有收集过，如果收集过就不再收集
      // 之前没有被收集，当前被收集，则在关联的Dep中添加当前effect
    // 之前被收集，当前也被收集，则保持不变

      if (effectTrackDepth <= maxMarkerBits) {
        // 优化方案 记录恢复上一次dep状态 即更改w
        initDepMarkers(this)
      } else {
        // 超出最大递归深度，简单方案：执行前先从各个依赖集合中删除，避免遗留依赖以及引起不必要的更新
        cleanupEffect(this)
      }
      // 执行fn
      return this.fn()
    } finally {
      // 移除多余依赖、恢复activeEffect、shouldTrack、调用--effectTrackDepth & trackOpBit更新
      if (effectTrackDepth <= maxMarkerBits) {
        // 整理effect deps 删除失效无用的dep, 恢复 dep w n状态
        finalizeDepMarkers(this)
      }

      trackOpBit = 1 << --effectTrackDepth // 恢复追踪深度

      activeEffect = this.parent // 更新，指向副作用栈顶
      shouldTrack = lastShouldTrack // 更新
      this.parent = undefined // 从栈中删除该副作用

      if (this.deferStop) {
        this.stop()
      }
    }
  }

  stop() {
    // stopped while running itself - defer the cleanup
    // 如果当前副作用是自己，等执行完再终止
    if (activeEffect === this) {
      this.deferStop = true
    } else if (this.active) {
      cleanupEffect(this)
      if (this.onStop) {
        this.onStop()
      }
      this.active = false // 标识当前副作用已经执行结束
    }
  }
}
```

### track

```js
// 2. 执行渲染更新函数，进行依赖收集
// 建立weakMap结构，获取dep
function track(target, type, key) {
  if(shouldTrack && activeEffect) {
    let depMap = targetMap.get(target)
    if(!depMap) {
        targetMap.set(target, depMap = new Map());
    }
    let dep = depMap.get(key);
    if(!dep) {
      depMap.set(key, dep = new createDep())
    }
    const eventInfo = {effect: activeEffect, target, type, key}
    trackEffects(dep, eventInfo)
  }
}

// 双向收集
function trackEffects(dep, eventInfo) {
  let shouldTrack = false;
  // 判断是否应该收集
  if(effectTrackDepth <= maxMarkerBits) {
    // 本次如果没有收集过当前dep，就看之前有没有收集过，如果收集过就不再收集
    if(!newTrack(dep)) {
      dep.n |= trackOpBit; // 记录是当前收集的依赖
      shouldTrack = !wasTracked(dep)
    }
  } else {
    shouldTrack = !dep.has(activeEffect!) // 原来有就不重复收集了
  }

  if (shouldTrack) {
    // 2. 收集
    dep.add(activeEffect!)
    activeEffect!.deps.push(dep)
  }
}
```

### trigger

```js
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target);
  if (!depsMap) {
    // never been tracked 没有收集过
    return;
  }

  // 需要触发的deps
  let deps: (Dep | undefined)[] = [];
  // 如果是 Map|Set 的clear操作, depsMap中的所有dep都需要trigger
  if (type === TriggerOpTypes.CLEAR) {
    deps = [...depsMap.values()];
    // 如果修改的是数组的长度,length和被删除的下标的key 关联的dep都应该被触发
    // 如arr.length = 3; 只会影响key为length以及元素索引大于等于其新数组长度值的effect
  } else if (key === "length" && isArray(target)) {
    const newLength = Number(newValue);
    depsMap.forEach((dep, key) => {
      if (key === "length" || key >= newLength) {
        deps.push(dep);
      }
    });
  } else {
    // 处理 SET | ADD | DELETE 这三种 TriggerOpTypes

    // 先获取当前key关联的deps
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      deps.push(depsMap.get(key));
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      // add
      case TriggerOpTypes.ADD:
        // 数组需要单独判断，数组的迭代收集到的key是length
        if (!isArray(target)) {
          // 对象属性的增加和删除都会影响for...in的次数，需要触发ITERATE_KEY
          deps.push(depsMap.get(ITERATE_KEY));
          if (isMap(target)) {
            // 如果是map还需要收集MAP_KEY_ITERATE_KEY
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY));
          }
        } else if (isIntegerKey(key)) {
          // 如果是数组新增下标那么length一定会修改
          // 当使用api时底层里面会先添加数据，这时数据内的length直接就被更改了，当拦截到length更改时已经获取不到旧值，前面我们看Proxy的set处理器触发前会做一条判断，那就是只有key的value更改了才会触发，这里length始终不会触发，因为始终是一致，所以当添加时就应该要触发
          deps.push(depsMap.get("length"));
        }
        break;
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          // 对象属性的增加和删除都会影响for...in的次数，需要触发ITERATE_KEY
          deps.push(depsMap.get(ITERATE_KEY));
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY));
          }
        }
        // 删除操作一定会有length属性的变化，会引起length的trigger，这里就不需要重复收集
        // 底层删除数组某项时都是通过更改length来实现，能够获取到旧值，当length新旧值发生更改时能够trigger所以就不需要重复收集了
        break;
      case TriggerOpTypes.SET:
        // map 的 set 不会改变 keys() 的结果，不需要再触发
        // 只收集map：Map可以通过entries和values直接获取，所以Map应该关联上ITERATE_KEY，而Set数据结构并没有提供直接修改的方法所以也不需要判断
        if (isMap(target)) {
          deps.push(depsMap.get(ITERATE_KEY));
        }
        break;
    }
  }

  const eventInfo = __DEV__
    ? { target, type, key, newValue, oldValue, oldTarget }
    : undefined;
  // 只有一个Dep依赖则直接triggerEffects
  if (deps.length === 1) {
    if (deps[0]) {
      if (__DEV__) {
        triggerEffects(deps[0], eventInfo);
      } else {
        triggerEffects(deps[0]);
      }
    }
  } else {
    // 假如有多个deps需要对内部的effect做一遍去重
    const effects: ReactiveEffect[] = [];
    for (const dep of deps) {
      if (dep) {
        effects.push(...dep);
      }
    }
  }
}

export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // 获取所有effect
  const effects = isArray(dep) ? dep : [...dep];
  // 为什么是这样的优先顺序？ 更合理一点：
  // 先计算最新的computed值，如果其他的副作用依赖这个computed值，直接就用最新的了
  // 如果先执行其他辅作用，然后再执行computed、computed值发生了改变，又会引起其他的副作用执行

  // 先执行带有computed属性的副作用
  for (const effect of effects) {
    if (effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo);
    }
  }
  // 再执行非computed属性的副作用
  for (const effect of effects) {
    if (!effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo);
    }
  }
}

export function triggerEffect(
  effect: ReactiveEffect,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  //这里判断 effect !== activeEffect的原因是：不能和当前激活effect 相同
  // 比如：count.value++，如果这是个effect，会触发getter，track收集了当前激活的 effect，
  // 然后count.value = count.value+1 会触发setter，执行trigger，
  // 就会陷入一个死循环，所以要过滤当前的 effect

  // 如果触发关联的effect 是当前正在执行的，并且没有声明允许递归则不在重复执行
  if (effect !== activeEffect || effect.allowRecurse) {
    // 如果当前effect有注册调度器，则使用调度器，否则则执行effect注册的函数
    if (effect.scheduler) {
      effect.scheduler();
    } else {
      effect.run();
    }
  }
}
```
