import urllib.request
for url in ['https://github.com','https://raw.githubusercontent.com/madbca420/code-sanctum-flow/main/README.md']:
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            print(url, 'STATUS', r.status)
            print(r.read(200).decode('utf-8', 'ignore'))
    except Exception as e:
        print(url, 'ERROR', repr(e))
