import { castArray, uniqueId } from "lodash-es"
import produce, { Draft } from "immer"

type NamedOrInSeries<T, K> = keyof K | T | (keyof K | T)[]

// Actions

export type IAction<D> = (data: Draft<D>, payload: any, result: any) => any

export type IActionConfig<D> = (data: D, payload: any, result: any) => any

export type IActionsConfig<D, A> = NamedOrInSeries<IActionConfig<D>, A>

// Conditions

export type ICondition<D> = (
  data: Draft<D>,
  payload: any,
  result: any
) => boolean

export type IConditionConfig<D> = (
  data: D,
  payload: any,
  result: any
) => boolean

type IConditionsConfig<D, A> = NamedOrInSeries<IConditionConfig<D>, A>

// Results

export type IResult<D> = (data: D | Draft<D>, payload: any, result: any) => void

export type IResultConfig<D> = (
  data: D | Draft<D>,
  payload: any,
  result: any
) => void

type IResultsConfig<D, R> = NamedOrInSeries<IResultConfig<D>, R>

// Computed values

// Event Handlers (Config)

interface IEventHandlerConfig<D, A, C, R> {
  do?: IActionsConfig<D, A>
  if?: IConditionsConfig<D, C>
  ifAny?: IConditionsConfig<D, C>
  unless?: IConditionsConfig<D, C>
  get?: IResultsConfig<D, R>
  to?: string
  wait?: number
}

type IEventHandlersConfig<D, A, C, R> =
  | IEventHandlerConfig<D, A, C, R>
  | IEventHandlerConfig<D, A, C, R>[]

type IEventConfig<D, A, C, R> =
  | IActionsConfig<D, A>
  | IEventHandlersConfig<D, A, C, R>

type IEventsConfig<D, A, C, R> = Record<string, IEventConfig<D, A, C, R>>

// Event Handlers (final)

interface IEventHandler<D> {
  do: IAction<D>[]
  if: ICondition<D>[]
  ifAny: ICondition<D>[]
  unless: ICondition<D>[]
  get: IResult<D>[]
  to?: string
  wait?: number
}

type IEvent<D> = IEventHandler<D>[]

type IEvents<D> = Record<string, IEvent<D>[]>

// Named functions

type NamedFunctions<A, C, R> = {
  actions?: A
  conditions?: C
  results?: R
}

// States

interface IStateConfig<D, A, C, R> {
  on?: IEventsConfig<D, A, C, R>
  onEvent?: IEventConfig<D, A, C, R>
  states?: IStatesConfig<D, A, C, R>
  initial?: string
}

type IStatesConfig<D, A, C, R> = Record<string, IStateConfig<D, A, C, R>>

/* -------------------------------------------------- */
/*                       Classes                      */
/* -------------------------------------------------- */

// Machine subscriber

type Subscriber<
  D extends any,
  A extends Record<string, IActionConfig<D>>,
  C extends Record<string, IConditionConfig<D>>,
  R extends Record<string, IResultConfig<D>>
> = (active: IStateNode<D, A, C, R>[], data: D) => void

// Machine configuration

export interface StateDesignerConfig<
  D extends any,
  A extends Record<string, IActionConfig<D>>,
  C extends Record<string, IConditionConfig<D>>,
  R extends Record<string, IResultConfig<D>>
> {
  data: D
  on?: IEventsConfig<D, A, C, R>
  onEvent?: IEventConfig<D, A, C, R>
  initial?: string
  states?: IStatesConfig<D, A, C, R>
  actions?: A
  conditions?: C
  results?: R
}

export function createStateDesignerConfig<
  D extends any,
  A extends Record<string, IActionConfig<D>>,
  C extends Record<string, IConditionConfig<D>>,
  R extends Record<string, IResultConfig<D>>
>(options: StateDesignerConfig<D, A, C, R>) {
  return options
}

export function createStateDesigner<
  D extends any,
  A extends Record<string, IActionConfig<D>>,
  C extends Record<string, IConditionConfig<D>>,
  R extends Record<string, IResultConfig<D>>
>(options: StateDesignerConfig<D, A, C, R>) {
  return new StateDesigner(options)
}

/* --------------------- Machine -------------------- */

class StateDesigner<
  D extends any,
  A extends Record<string, IActionConfig<D>>,
  C extends Record<string, IConditionConfig<D>>,
  R extends Record<string, IResultConfig<D>>
> {
  id = uniqueId()
  data: D
  namedFunctions: NamedFunctions<A, C, R>
  active: IStateNode<D, A, C, R>[] = []
  root: IStateNode<D, A, C, R>
  subscribers = new Set<Subscriber<D, A, C, R>>([])

  constructor(options = {} as StateDesignerConfig<D, A, C, R>) {
    const {
      data,
      initial,
      states = {},
      on = {},
      onEvent,
      actions,
      conditions,
      results
    } = options

    this.data = data

    this.namedFunctions = {
      actions,
      conditions,
      results
    }

    this.root = new IStateNode({
      machine: this,
      on,
      onEvent,
      states,
      initial,
      name: "root",
      active: true
    })

    this.active = this.root.getActive()
  }

  private notifySubscribers = () => {
    this.subscribers.forEach(subscriber => subscriber(this.active, this.data))
  }

  subscribe = (onChange: Subscriber<D, A, C, R>) => {
    this.subscribers.add(onChange)
    return () => this.unsubscribe(onChange)
  }

  unsubscribe = (onChange: Subscriber<D, A, C, R>) => {
    this.subscribers.delete(onChange)
  }

  send = (event: string, payload?: any) => {
    const reversedActiveStates = [...this.active].reverse()

    let result = {}

    this.data = produce(this.data, draft => {
      for (let state of reversedActiveStates) {
        // Move this to the state eventually
        let eventHandlers = state.events[event]
        if (eventHandlers === undefined) continue

        for (let eventHandler of eventHandlers) {
          for (let handler of eventHandler) {
            state.handleEventHandler(handler, draft, payload, result)

            let previous = false
            let restore = false

            let { to: transition } = handler

            if (transition !== undefined) {
              if (transition.endsWith(".previous")) {
                previous = true
                transition = transition.substring(0, transition.length - 9)
              } else if (transition.endsWith(".restore")) {
                previous = true
                restore = true
                transition = transition.substring(0, transition.length - 8)
              }

              const target = state.getTargetFromTransition(transition, state)
              if (target !== undefined) {
                target.activate(previous, restore)
                break
              }
            }
          }
        }

        const { onEvent } = state.autoEvents

        if (onEvent !== undefined) {
          for (let eventHandler of onEvent) {
            for (let handler of eventHandler) {
              state.handleEventHandler(handler, draft, payload, result)

              let previous = false
              let restore = false

              let { to: transition } = handler

              if (transition !== undefined) {
                if (transition.endsWith(".previous")) {
                  previous = true
                  transition = transition.substring(0, transition.length - 9)
                } else if (transition.endsWith(".restore")) {
                  previous = true
                  restore = true
                  transition = transition.substring(0, transition.length - 8)
                }

                const target = state.getTargetFromTransition(transition, state)
                if (target !== undefined) {
                  target.activate(previous, restore)
                  break
                }
              }
            }
          }
        }
      }
    })

    this.active = this.root.getActive()
    this.notifySubscribers()
  }

  can = (event: string, payload?: any): boolean => {
    const reversedActiveStates = [...this.active].reverse()
    let result: any

    return produce(this.data, draft => {
      for (let state of reversedActiveStates) {
        let eventHandlers = state.events[event]
        if (eventHandlers !== undefined) {
          for (let eventHandler of eventHandlers) {
            for (let handler of eventHandler) {
              for (let resolver of handler.get) {
                result = resolver(draft, payload, result)
              }

              if (state.canEventHandlerRun(handler, draft, payload, result)) {
                return true
              }
            }
          }
        }
      }

      return false
    })
  }

  isIn = (name: string) => {
    return this.active.find(v => v.path.endsWith(name))
  }

  get state() {
    return this.root
  }
}

/* ------------------- State Node ------------------- */

enum StateType {
  Leaf = "leaf",
  Branch = "branch",
  Parallel = "parallel"
}

class IStateNode<
  D,
  A extends Record<string, IActionConfig<D>>,
  C extends Record<string, IConditionConfig<D>>,
  R extends Record<string, IResultConfig<D>>
> {
  name: string
  path: string
  active = false
  previous?: IStateNode<D, A, C, R>
  machine: StateDesigner<D, A, C, R>
  parent?: IStateNode<D, A, C, R>
  type: StateType
  initial?: string
  children: IStateNode<D, A, C, R>[] = []
  events: IEvents<D> = {}
  autoEvents: {
    onEvent?: IEvent<D>[]
  }

  constructor(
    options = {} as {
      name: string
      parent?: IStateNode<D, A, C, R>
      active: boolean
      on?: IEventsConfig<D, A, C, R>
      onEvent?: IEventConfig<D, A, C, R>
      machine: StateDesigner<D, A, C, R>
      states?: IStatesConfig<D, A, C, R>
      initial?: string
    }
  ) {
    const {
      machine,
      parent,
      on = {},
      name,
      initial,
      states = {},
      onEvent,
      active
    } = options

    this.machine = machine

    this.parent = parent

    this.active = active

    this.name = name

    this.path = this.parent ? this.parent.path + "." + name : this.name

    // CHILDREN

    this.initial = initial

    this.children = Object.keys(states).reduce<IStateNode<D, A, C, R>[]>(
      (acc, cur) => {
        const state = states[cur]

        acc.push(
          new IStateNode({
            name: cur,
            machine: this.machine,
            parent: this,
            active: this.initial === undefined ? true : cur === this.initial,
            initial: state.initial,
            states: state.states,
            onEvent: state.onEvent,
            on: state.on
          })
        )
        return acc
      },
      []
    )

    if (this.initial !== undefined) {
      this.previous = this.children.find(v => v.name === this.initial)
    }

    // TYPE

    this.type =
      this.children.length === 0
        ? StateType.Leaf
        : this.initial === undefined
        ? StateType.Parallel
        : StateType.Branch

    // EVENTS

    // We need to return a "full" event handler object, but the
    // config value may either be an anonymous action function,
    // a named action function, or a partial event handler object.

    const { namedFunctions } = this.machine

    // Begin giant typescript mess - TODO: Compress into one function

    function getAction(item: keyof A | IActionConfig<D>) {
      if (typeof item === "function") {
        return item as IAction<D>
      } else if (typeof item === "string") {
        const items = namedFunctions.actions

        if (items === undefined) {
          console.error(Errors.noNamedFunction(item, "action"))
          return
        }

        const callback = items[item]
        if (callback === undefined) {
          console.error(Errors.noMatchingNamedFunction(item, "action"))
          return
        }

        return callback
      }
      return
    }

    function getActions(source: any) {
      return castArray(source || []).reduce<IAction<D>[]>((acc, a) => {
        const item = getAction(a)
        return item === undefined ? acc : [...acc, item as IAction<D>]
      }, [])
    }

    function getCondition(item: keyof C | IConditionConfig<D>) {
      if (typeof item === "function") {
        return item as ICondition<D>
      } else if (typeof item === "string") {
        const items = namedFunctions.conditions

        if (items === undefined) {
          console.error(Errors.noNamedFunction(item, "condition"))
          return
        }

        const callback = items[item]
        if (callback === undefined) {
          console.error(Errors.noMatchingNamedFunction(item, "condition"))
          return
        }

        return callback
      }

      return
    }

    function getConditions(source: any) {
      return castArray(source || []).reduce<ICondition<D>[]>((acc, a) => {
        const item = getCondition(a)
        return item === undefined ? acc : [...acc, item as ICondition<D>]
      }, [])
    }

    function getResult(item: keyof R | IResultConfig<D>) {
      if (typeof item === "function") {
        return item as IResult<D>
      } else if (typeof item === "string") {
        const items = namedFunctions.results

        if (items === undefined) {
          console.error(Errors.noNamedFunction(item, "result"))
          return
        }

        const callback = items[item]
        if (callback === undefined) {
          console.error(Errors.noMatchingNamedFunction(item, "result"))
          return
        }

        return callback
      }
      return
    }

    function getResults(source: any) {
      return castArray(source || []).reduce<IResult<D>[]>((acc, a) => {
        const item = getResult(a)
        return item === undefined ? acc : [...acc, item as IResult<D>]
      }, [])
    }

    // End giant typescript mess

    const getProcessedEventHandler = (
      eventHandler: IEventConfig<D, A, C, R>
    ) => {
      const handlers = castArray(eventHandler)

      return handlers.map<IEventHandler<D>>(v => {
        let result: IEventHandler<D> = {
          get: [],
          if: [],
          unless: [],
          ifAny: [],
          do: [],
          to: undefined
        }

        if (typeof v === "string" || typeof v === "function") {
          const item = getAction(v)
          if (item !== undefined) result.do = [item as IAction<D>]
        } else if (typeof v === "object") {
          result.get = getResults(v.get)
          result.if = getConditions(v.if)
          result.unless = getConditions(v.unless)
          result.ifAny = getConditions(v.ifAny)
          result.do = getActions(v.do)
          result.to = v.to
        }

        return result
      })
    }

    const getProcessedEvent = (event: IEventConfig<D, A, C, R>) => {
      return castArray(event).map<IEvent<D>>(getProcessedEventHandler)
    }

    this.autoEvents = {
      onEvent: onEvent ? getProcessedEvent(onEvent) : undefined
    }

    this.events = Object.keys(on).reduce<IEvents<D>>((acc, key) => {
      acc[key] = getProcessedEvent(on[key])
      return acc
    }, {})
  }

  getTargetFromTransition = (
    transition: string,
    state: IStateNode<D, A, C, R>
  ): IStateNode<D, A, C, R> | undefined => {
    // handle transition (rough draft)
    const target = state.children.find(v => v.name === transition)
    if (target !== undefined) {
      // transition to target
      return target
    } else if (state.parent !== undefined) {
      // crawl up tree
      return this.getTargetFromTransition(transition, state.parent)
    }

    return
  }

  activateDown = (previous = false, restore = false) => {
    this.active = true

    if (this.type === "branch") {
      const activeChild = previous
        ? this.children.find(
            v => v.name === (this.previous ? this.previous.name : this.initial)
          )
        : this.children.find(v => v.name === this.initial)

      if (activeChild !== undefined) {
        this.previous = activeChild
        activeChild.activateDown(restore, restore)
      }
    }

    if (this.type === "parallel") {
      for (let child of this.children) {
        child.activateDown(restore, restore)
      }
    }
  }

  activateUp = () => {
    if (this.parent) {
      this.parent.active = true

      if (this.parent.type === "branch") {
        this.parent.previous = this
        // Deactivate siblings
        for (let sib of this.parent.children) {
          if (sib === this) continue
          if (sib.active) {
            sib.deactivate()
          }
        }
      }

      // Activate inactive parallel siblings
      if (this.parent.type === "parallel") {
        for (let sib of this.parent.children) {
          if (sib === this) continue
          if (!sib.active) {
            sib.activateDown()
          }
        }
      }

      this.parent.activateUp()
    }
  }

  activate = (previous = false, restore = false) => {
    this.activateDown(previous, restore)
    this.activateUp()
  }

  deactivate = () => {
    this.active = false
    for (let state of this.children) {
      state.deactivate()
    }
  }

  canEventHandlerRun = (
    handler: IEventHandler<D>,
    draft: Draft<D>,
    payload: any,
    result: any
  ) => {
    // --- Conditions

    // Every `if` condition must return true
    if (
      handler.if.length > 0 &&
      !handler.if.every(c => c(draft, payload, result))
    )
      return false

    // Every `unless` condition must return false
    if (
      handler.unless.length > 0 &&
      handler.unless.some(c => c(draft, payload, result))
    )
      return false

    // One or more `ifAny` conditions must return true
    if (
      handler.ifAny.length > 0 &&
      !handler.ifAny.some(c => c(draft, payload, result))
    )
      return false

    return true
  }

  handleEventHandler = (
    handler: IEventHandler<D>,
    draft: Draft<D>,
    payload: any,
    result: any
  ) => {
    // --- Resolvers

    for (let resolver of handler.get) {
      result = resolver(draft, payload, result)
    }

    // --- Conditions

    if (!this.canEventHandlerRun(handler, draft, payload, result)) return draft

    // --- Actions
    for (let action of handler.do) {
      action(draft, payload, result)
    }

    return draft
  }

  public getActive = (): IStateNode<D, A, C, R>[] => {
    if (!this.active) {
      return []
    }

    return [
      this,
      ...this.children.reduce<IStateNode<D, A, C, R>[]>((acc, child) => {
        acc.push(...child.getActive())
        return acc
      }, [])
    ]
  }
}

export default StateDesigner

const Errors = {
  noNamedFunction: (name: string, type: string) =>
    `Error! You've referenced a named ${type} (${name}) but your configuration does not include any named ${type}s.`,
  noMatchingNamedFunction: (name: string, type: string) =>
    `Error! You've referenced a named ${type} (${name}) but your configuration does not include any named ${type}s with that name.`
}

export type StateDesignerWithConfig<
  C extends StateDesignerConfig<any, any, any, any>
> = StateDesigner<C["data"], C["actions"], C["conditions"], C["results"]>

// use create statedesignerconfig
// get typeof result

// const tConfig = createStateDesignerConfig({
//   data: {
//     toggled: false
//   }
// })

// type ToggleMachine = StateDesignerWithConfig<typeof tConfig>

// const test = createStateDesigner({
//   data: {
//     count: 0,
//     toggles: [] as ToggleMachine[],
//     toggle: new StateDesigner({
//       data: {},
//       states: {
//         active: {},
//         inactive: {}
//       }
//     })
//   },
//   on: {
//     INCREMENT: {
//       do: "increment"
//     }
//   },
//   actions: {
//     increment: data => data.count++
//   },
//   conditions: {
//     aboveMin: data => data.count > 0
//   },
//   results: {},
//   states: {}
// })
