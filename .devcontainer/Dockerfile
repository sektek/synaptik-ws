FROM mcr.microsoft.com/devcontainers/typescript-node:22-bookworm

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    iputils-ping \
    telnet \
    jq \
    tmux

RUN npm install -g npm@latest && npm uninstall -g npm@9.8.1
