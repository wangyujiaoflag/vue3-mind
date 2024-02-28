## reactive

### reactive 用法

- reactive 只能对对象操作
- reactive 不会一次性将对象的所有属性都转换为响应式对象，而是只有在访问属性时才会
- 响应式对象可以转换为只读对象（转换后的对象既是响应式的又是只读的），但是只读对象不能转换为响应式对象

### reactive 源码

1. 如果 target 是只读的，会直接返回 target
2. 否则，将其转换为响应式对象

   - 对 target 判断，如果不是对象，直接返回
   - 如果 target 已经是响应式对象且不是仅可读的，直接返回
   - 从 proxyMap 中取出 target 对应的响应式对象，如果存在，返回值，如果不存在，获取 target 类型，然后对有效类型的 target 进行代理，并将结果缓存到 proxyMap 中
   - 返回代理值

```js
export function reactive(target: object) {
  if (isReadonly(target)) {
    return target;
  }
  // target，readonly、baseHandlers、collectionHandlers、proxyMap
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  );
}

function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  if (!isObject(target)) {
    return target;
  }

  // 已经是响应式对象就直接返回
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target;
  }
  // 缓存，避免了为同一个原始对象多次创建代理对象的问题
  // const obj = {}
  // const arr = reactive([obj])
  // console.log(arr.includes(arr[0]))  // 没有existingProxy时会返回false（arr[0]为响应式对象，每次都会重新创建一个，所以会返回false）
  const existingProxy = proxyMap.get(target);
  if (existingProxy) {
    return existingProxy;
  }
  // 只有🈯️定的值类型才可以被观察
  const targetType = getTargetType(target);
  // skip和不可拓展的直接返回
  if (targetType === TargetType.INVALID) {
    return target;
  }
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  );
  proxyMap.set(target, proxy);
  return proxy;
}
```

```js
// 获取target类型
// skip、不可拓展的都为无效类型
function getTargetType(value: Target) {
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value));
}

function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

const enum TargetType {
  INVALID = 0, // 无效的
  COMMON = 1, // common
  COLLECTION = 2 // 集合
}
```

### proxy 代理（用可读可写的举例）

- 遵循 ESMA 语言规范，在读取、设置对象属性时进行拦截（普通对象、数组、set，map 等集合类型）
  - 例如数组的内部方法 [[DefineOwnProperty]] 不同于常规对象。如果数组的长度小于索引，要更新 length。所以当通过索引设置元素值时，有可能需要隐式触发与 length 相关联的副作用；长度的变化也可能引起元素值的变化，需要触发索引值大于数组长度的所有副作用。
    - 数组的方法内部其实都依赖了对象的基本语义。所以大多数情况下，不需要做特殊处理即可让这些方法按预期工作，但是某些数组方法并不总是按照预期工作，需要改写

```js
export const mutableHandlers: ProxyHandler<object> =
  /*#__PURE__*/ new MutableReactiveHandler()

class MutableReactiveHandler extends BaseReactiveHandler {
  constructor(shallow = false) {
    // readonly，shallow
    super(false, shallow)
  }

  set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    let oldValue = (target as any)[key]
    // oldValue is readonly and ref，but newValue is not ref，return false
    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }
    // deep 修改值
    if (!this._shallow) {
      // 获取新旧值原生值
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      // 修改旧值，将value复制给oldValue.value
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // 在浅层模式下，无论是否具有响应式，对象都按原样设置
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    // 判断receiver是当前对象target的代理对象时才触发，屏蔽由原型引起的更新，从而避免不必要的更新操作
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
  // delete
  deleteProperty(target: object, key: string | symbol): boolean {
    const hadKey = hasOwn(target, key)
    const oldValue = (target as any)[key]
    const result = Reflect.deleteProperty(target, key)
    if (result && hadKey) {
      trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
    }
    return result
  }
  // key in obj
  has(target: object, key: string | symbol): boolean {
    const result = Reflect.has(target, key)
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
      track(target, TrackOpTypes.HAS, key)
    }
    return result
  }
  // for...in
  // ownKeys只能拿到目标对象 target,用来获取一个对象的所有属于自己的键值，这个操作明显不与任何具体的键进行绑定，因此我们只能够构造唯一的 key 作为标识，即 ITERATE_KEY
  // 对于数组来说，影响for...in是数组的长度属性，而改变数组长度的方法有两种，直接用length都能够正确地触发响应
  ownKeys(target: object): (string | symbol)[] {
    track(
      target,
      TrackOpTypes.ITERATE,
      isArray(target) ? 'length' : ITERATE_KEY
    )
    return Reflect.ownKeys(target)
  }
}

class BaseReactiveHandler implements ProxyHandler<Target> {
  constructor(
    protected readonly _isReadonly = false,
    protected readonly _shallow = false
  ) {}

  get(target: Target, key: string | symbol, receiver: object) {
    const isReadonly = this._isReadonly,
      shallow = this._shallow
      // 获取对象是否是响应式的
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
      // 获取对象是否是只读的
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
      // 获取对象是否是浅响应式的
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return shallow
      // 获取源对象，如果代理已被创建过，直接返回被代理对象
    } else if (
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
          ? shallowReactiveMap
          : reactiveMap
        ).get(target)
    ) {
      return target
    }

    const targetIsArray = isArray(target)

    if (!isReadonly) {
      // 数组的部分方法通过数组改造器arrayInstrumentations访问和进行依赖收集
      if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
        return Reflect.get(arrayInstrumentations, key, receiver)
      }
      // 访问hasOwnProperty属性，依赖收集
      if (key === 'hasOwnProperty') {
        return hasOwnProperty
        // function hasOwnProperty(this: object, key: string) {
        //   const obj = toRaw(this)
        //   track(obj, TrackOpTypes.HAS, key)
        //   return obj.hasOwnProperty(key)
        // }
      }
    }

    // 获取访问的结果
    const res = Reflect.get(target, key, receiver)

    // 不追踪，为了性能，以及避免额外的错误
    // 如果是内置的symbol或者是不允许收集的key，直接返回结果
    // builtInSymbols：Object.getOwnPropertyNames(Symbol).filter(key => key !== 'arguments' && key !== 'caller').map(key => (Symbol as any)[key]).filter(isSymbol)
    // const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

    // get依赖收集
    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    // 如果是浅响应的，返回结果，不用执行后续的了
    if (shallow) {
      return res
    }

    if (isRef(res)) {
      // 通过索引访问数组获取的结果是ref对象时，不用解包
      return targetIsArray && isIntegerKey(key) ? res : res.value
    }

    if (isObject(res)) {
      // 将返回值也转换为代理。我们这里进行 isObject 检查是为了避免无效值警告。还需要惰性访问只读
      // 此处采用响应式以避免循环依赖。
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}
// 数组的内部方法 [[DefineOwnProperty]]不同于常规对象：
// 如果数组的长度小于索引，更新length。所以通过索引设置元素值时，有可能需要隐式触发length相关联的副作用
// 长度的变化也可能引起元素值的变化，需要触发索引值大于数组长度的所有副作用

// 通过索引读取或设置数组元素的值时，代理对象的 get/set 拦截函数也会执行
// 遍历：数组使用for...in遍历和普通对象没什么不同，影响for...in的是数组长度的变化，导致数组长度变化有两种方式，改变数组长度、设置元素属性，对于普通对象是使用人造key，对于数组可以通过length触发
// for..of: 数组迭代器的执行会读取数组的 length 属性。如果迭代的是数组元素值，还会读取数组的索引,数组迭代器的执行会读取数组的 length 属性。如果迭代的是数组元素值，还会读取数组的索引,这个已经实现了，不需要额外操作
// includes、indexOf、lastIndexOf根据给定的值返回查找结果，ecma里定义的语法规则与其他不同，需要改写
const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

// this是响应式的proxy对象
function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // instrument identity-sensitive Array methods to account for possible reactive values
  // 查找元素时，会读取length属性和每个索引，通过索引获取值
  // 手动收集每个子项
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // 当前响应式对象指向的那个原始数组
      const arr = toRaw(this) as any
      // 收集每个子项 key = arrIndex
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      // 使用传进来的参数获取结果（参数可能是响应式的）
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        // if that didn't work, run it again using raw values. 转换为原生的试试
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // 隐式修改数组长度的方法需要改造
  // 在执行这些方法时，既会读取length，又会设置length，避免length属性被无限循环的收集，需要改造
  // 这些操作本质是对length的修改，不是读取，因此屏蔽length的读取
  // 对array.length会改变的阻止收集
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking()
      // 通过源数组更改，不走代理
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}
```
