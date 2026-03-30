const createReduxStore = jest.fn((name, config) => ({
	name,
	...config,
}));
const register = jest.fn();

module.exports = { createReduxStore, register };
