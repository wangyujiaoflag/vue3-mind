## 响应式设计

数据驱动开发

### 需要考虑的问题

#### 副作用函数名称不同，如何准确加入集合中?

- 不应该直接将副作用函数加入集合中，
  而是先注册给全局变量 activeEffect，再将 activeEffect 加入集合中
  ```js
  activeEffect = undefined;
  function effect(fn) {
    if (!activeEffect) activeEffect = fn;
  }
  ```

#### 集合的设计如何确保操作对象和副作用函数之间能够建立明确的关系?

```ts
WeakMap<target, Map<key, Set<Effect>>>; // Set：key的依赖集合
```

- WeakMap 对 key 是弱引用，不影响垃圾回收器的工作。
  一旦 key 被垃圾回收器回收，那么对应的键和值就访问不到了。
- WeakMap 经常用于存储那些只有当 key 所引用的对象存在时（没有被回收）才有价值的信息
- 如果使用 Map，可能会导致内存溢出

#### 如何解决分支切换（条件语句）所产生遗留的副作用以及触发不必要的更新问题?

- 在执行副作用前将副作用从所有与之关联的依赖集合中删除，然后在执行副作用，这样会重新建立联系（这里需要明确知道哪些依赖集合包含这个副作用:effect.deps）

```js
// 举例:当 obj.text 改为 false 时，修改 obj.a 后会触发 effect 再次执行，但这是不应该的！
// 触发的原因是因为集合中存在 a-effect 的关系

// 解决：obj.text修改为false，触发副作用执行，先将effect从与之关联的依赖集合中删除，然后执行effect，此时相关的只有text，只会建立text于effect的联系，后续不管怎么修改a，都不会触发副作用的执行
function effect() {
  return obj.text ? obj.a : "text";
}

// track的时候
function track(target, key) {
  let deps = depsMap.get(key);
  deps.add(activeEffect);
  activeEffect.deps.push(deps); // 需要明确知道这个副作用在哪些依赖集合中
}
// trigger
function trigger() {
  // 触发执行的时候
  cleanup(); // 解绑
  // 这里需要把他放到一个新的集合中遍历执行
  // effects.forEach((fn) => fn()); // 遍历触发 这样会导致无限执行 因为函数先剔除再执行后，又会重新收集到effects中，effects永远执行不完
}
```

#### 如何解决在嵌套的副作用下，会导致当前激活的副作用 activeEffect 错误的问题

- 定义一个栈，保存当前的副作用，当副作用执行后，再从栈中推出，activeEffect 永远指向栈顶

```javascript
const stack = [];
function effect(fn) {
  const effectFn = function (fn) {
    cleanup(fn);
    activeEffect = effectFn;
    stack.push(effectFn);
    fn();
    stack.pop();
    activeEffect = stack[stack.length - 1];
  };
  effectFn.deps = [];
}
```

#### 如何避免无限递归循环

- 如果 trigger 触发执行的副作用函数与当前正在执行的副作用函数相同，则不触发执行

#### 调度执行，如何能决定副作用函数执行的时机、次数以及方式

- 添加 scheduler，注入 effect 中
