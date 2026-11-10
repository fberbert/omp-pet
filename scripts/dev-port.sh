# Sourced by the dev helper scripts: resolves the running pet's /state URL from
# ~/.omp-pet/runtime.json, falling back to the default port.
OMP_PET_PORT=$(node -e 'try{const p=require(require("os").homedir()+"/.omp-pet/runtime.json").port;if(Number.isInteger(p)){console.log(p);process.exit(0)}}catch{}console.log(23533)')
OMP_PET_STATE_URL="http://127.0.0.1:${OMP_PET_PORT}/state"
