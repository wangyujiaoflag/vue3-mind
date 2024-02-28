## directive

- vModel

  ```js
  export const vModelText: ModelDirective<
    HTMLInputElement | HTMLTextAreaElement
  > = {
    created(el, { modifiers: { lazy, trim, number } }, vnode) {
      el[assignKey] = getModelAssigner(vnode) // 更新函数
      // 是否需要转换为number
      const castToNumber =
        number || (vnode.props && vnode.props.type === 'number')
      // 绑定事件 lazy处理事件类型
      addEventListener(el, lazy ? 'change' : 'input', e => {
        if ((e.target as any).composing) return
        let domValue: string | number = el.value
        // 值的处理
        if (trim) {
          domValue = domValue.trim()
        }
        if (castToNumber) {
          domValue = looseToNumber(domValue)
        }
        // 更新值 响应式值变化触发组件更新 界面到数据的更改
        el[assignKey](domValue)
      })
      if (trim) {
        addEventListener(el, 'change', () => {
          el.value = el.value.trim()
        })
      }
      if (!lazy) {
        addEventListener(el, 'compositionstart', onCompositionStart)
        addEventListener(el, 'compositionend', onCompositionEnd)
        // Safari < 10.2 & UIWebView doesn't fire compositionend when
        // switching focus before confirming composition choice
        // this also fixes the issue where some browsers e.g. iOS Chrome
        // fires "change" instead of "input" on autocomplete.
        addEventListener(el, 'change', onCompositionEnd)
      }
    },
    // set value on mounted so it's after min/max for type="range"
    mounted(el, { value }) {
      el.value = value == null ? '' : value
    },
    // 为什么更新input的新值放在vModelText指令的beforeUpdate中执行？
    // 在beforeUpdate中执行有两个优势：
    // 1、在更新DOM前更新input的新值，如果只是修改了input值，就省去了patchProp的部分操作，提高了patch性能；
    // 2、指令的beforeUpdate是DOM更新前同步执行的，而updated钩子函数是在DOM更新后异步执行的，如果业务复杂同步任务太多的情况下可能会出现更新延迟或者卡顿的现象。
    beforeUpdate(el, { value, modifiers: { lazy, trim, number } }, vnode) {
      // 重新获取onUpdate:modelValue函数，因为重新渲染函数可能更改了这个函数，并且重新给input赋值
      el[assignKey] = getModelAssigner(vnode)
      // avoid clearing unresolved text. #2302
      if ((el as any).composing) return
      if (document.activeElement === el && el.type !== 'range') {
        if (lazy) {
          return
        }
        if (trim && el.value.trim() === value) {
          return
        }
        if (
          (number || el.type === 'number') &&
          looseToNumber(el.value) === value
        ) {
          return
        }
      }
      // 设置新值
      const newValue = value == null ? '' : value
      if (el.value !== newValue) {
        el.value = newValue
      }
    }
  }
  ```

  - vShow

  ```js
  export const vShow: ObjectDirective<VShowElement> = {
    beforeMount(el, { value }, { transition }) {
      el[vShowOldKey] = el.style.display === "none" ? "" : el.style.display;
      if (transition && value) {
        transition.beforeEnter(el);
      } else {
        setDisplay(el, value);
      }
    },
    mounted(el, { value }, { transition }) {
      if (transition && value) {
        transition.enter(el);
      }
    },
    updated(el, { value, oldValue }, { transition }) {
      if (!value === !oldValue) return;
      if (transition) {
        if (value) {
          transition.beforeEnter(el);
          setDisplay(el, true);
          transition.enter(el);
        } else {
          transition.leave(el, () => {
            setDisplay(el, false);
          });
        }
      } else {
        setDisplay(el, value);
      }
    },
    beforeUnmount(el, { value }) {
      setDisplay(el, value);
    },
  };
  ```
