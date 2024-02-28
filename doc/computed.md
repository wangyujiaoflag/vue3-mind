## computed

### computed 用法

```js
// 回调 a只读
const a = computed(() => b + c);

// options配置 d可读可写
const d = computed({
  get() {},
  set() {},
});
```

### computed 源码

- 确定 computed 配置 getter、setter
- 实例化 computed
  - 创建 effect 副作用，定义 scheduler，只有在页面状态发生改变的情况下触发，手动触发依赖该 computed 的副作用

```js
export const computed: typeof _computed = (
  getterOrOptions: any,
  debugOptions?: any
) => {
  // @ts-ignore
  return _computed(getterOrOptions, debugOptions, isInSSRComponentSetup)
}
// _computed
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions,
  isSSR = false
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>
  // 判断第一个参数是否是回调函数，如果是的话，computed不能手动修改
  // 如果不是，computed可读可写，获取配置中的get、set
  const onlyGetter = isFunction(getterOrOptions)
  if (onlyGetter) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 实例化computed
  const cRef = new ComputedRefImpl(getter, setter, onlyGetter || !setter, isSSR)

  return cRef as any
}

export class ComputedRefImpl<T> {
  public dep?: Dep = undefined

  private _value!: T
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true
  public readonly [ReactiveFlags.IS_READONLY]: boolean = false

  public _dirty = true
  public _cacheable: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean,
    isSSR: boolean
  ) {
    this.effect = new ReactiveEffect(getter, () => {
      // 表示组件或页面的状态是否发生了变化 副作用触发的时候状态更新，dirty = true
      if (!this._dirty) {
        this._dirty = true
        // 当把计算属性用于另外一个 effect 时，就会发生 effect 嵌套，外层的 effect 不会被内层 effect 中的响应式数据收集
        // 所以在这里手动调用trigger触发响应
        triggerRefValue(this) // 触发自身
      }
    })
    // 为副作用函数赋computed属性，在触发阶段会优先执行带有computed属性的effect
    this.effect.computed = this
    this.effect.active = this._cacheable = !isSSR
    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    const self = toRaw(this)
    // 依赖收集
    trackRefValue(self)
    // 如果是SSR模式，则_cacheable则默认为false，从而每次get都会重新计算
    if (self._dirty || !self._cacheable) {
      self._dirty = false
      // 执行副作用函数获取执行结果
      self._value = self.effect.run()!
    }
    return self._value
  }

  set value(newValue: T) {
    this._setter(newValue)
  }
}

```
