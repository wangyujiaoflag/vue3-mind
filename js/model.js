// 数据拦截 + 发布订阅

// 响应式数据
const a = ref(1);
// 页面更新函数
function render() {}
// onclick: 点击之后，a自增并且页面更新
function add() {
  a.value++;
  render(); // 需手动执行更新
}

// 实现👇
// 发布者a的订阅者集合
let stack = [];
// 页面更新副作用
function effect() {
  render();
}
// 类似订阅管理器
Object.defineProperty(a, value, {
  get: () => {
    // 收集依赖
    stack.push(effect);
    return a.value;
  },
  set: (newValue) => {
    a.value = newValue;
    // 触发更新
    while (stack.length) {
      const fn = stack.pop();
      fn();
    }
  },
});

// proxy && reflect

// proxy: 对对象进行拦截处理，可以在拦截过程中做其他的处理，用于扩展js语言的功能
// reflect：es6提供的全局对象，对对象本身进行操作。包括创建、读取、删除属性等操作

// 原对象
const target = {
  name: "John",
  age: 25,
};

// 代理对象
const proxy = new Proxy(target, {
  get(target, prop, receiver) {
    console.log(`读取属性 ${prop}`);
    return Reflect.get(...arguments);
  },
  // 内部拦截target对象，设置属性值，修改proxy对象值
  set(target, prop, value, receiver) {
    console.log(`设置属性 ${prop} 的值为 ${value}`, ...arguments);
    return Reflect.set(...arguments); // 对原对象target对象进行设置操作
  },
});

// 1、直接操作代理对象即可
proxy.name = "wy";
