export const createReduxStore = jest.fn((name, config) => ({
	name,
	...config,
}));
export const register = jest.fn();
export const useSelect = jest.fn();
export const useDispatch = jest.fn(() => ({}));
