echo 'Iniciando servidor 1'

cd ./server1
thrust install
thrust startup.js &
PID1=$!

cd ..

echo 'Iniciando servidor 2'
cd ./server2
thrust install
thrust startup.js &
PID2=$!

cd ..

echo 'Iniciando testes'
thrust install
thrust test.js

kill -9 $PID1 $PID2