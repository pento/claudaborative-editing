const createReduxStore = jest.fn((name, config) => ({
	name,
	...config,
}));
const register = jest.fn();

export default { createReduxStore, register };
