export const workerOwnershipCompatibilityCases = ['pre-W8', 'PR1', 'PR2', 'PR3a', 'PR3b'].flatMap(
  generation =>
    ['empty', 'unowned', 'owned', 'unknown'].flatMap(profile =>
      ['Desktop', 'Web'].flatMap(client =>
        [false, true].map(adoption => ({ generation, profile, client, adoption })),
      ),
    ),
)
