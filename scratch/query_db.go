package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

func main() {
	dsn := "host=localhost port=5432 user=sub2api password=sub2api dbname=sub2api sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	var userID int64
	var groupID int64
	err = db.QueryRow("SELECT user_id, group_id FROM api_keys WHERE key = 'sk-c73bed6997f98b075410d8d972c9d18b6bf5beeb2d4e2272a2043166ccf9d658'").Scan(&userID, &groupID)
	if err != nil {
		log.Fatalf("Query working key failed: %v", err)
	}
	fmt.Printf("Working Key: UserID=%d, GroupID=%d\n", userID, groupID)

	rows, err := db.Query("SELECT id, name FROM groups")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	fmt.Println("\nAll Groups:")
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("ID=%d, Name=%s\n", id, name)
	}

	rows, err = db.Query("SELECT group_id, COUNT(*) FROM accounts_groups GROUP BY group_id")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	fmt.Println("\nGroup Account Counts:")
	for rows.Next() {
		var gid int64
		var count int
		if err := rows.Scan(&gid, &count); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("GroupID=%d, AccountCount=%d\n", gid, count)
	}
}
