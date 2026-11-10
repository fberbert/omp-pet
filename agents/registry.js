// Agent registry: the single supported agent is OMP (oh-my-pi).

const omp = require("./omp");

const AGENTS = [omp];
const AGENT_MAP = new Map(AGENTS.map((a) => [a.id, a]));

module.exports = {
  getAllAgents: () => AGENTS,
  getAgent: (id) => AGENT_MAP.get(id),
};
